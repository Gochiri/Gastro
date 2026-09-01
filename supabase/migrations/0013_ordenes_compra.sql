-- 0013_ordenes_compra.sql
-- Órdenes de compra con recepción parcial.
--
-- Cierra el ciclo abierto en la fase 3: confirmar una recepción genera las
-- filas de `compras` que la varianza de food cost ya consume. Sin esto, cada
-- entrada de mercadería había que cargarla dos veces.

create type estado_orden as enum (
  'borrador',   -- se está armando
  'enviada',    -- mandada al proveedor
  'parcial',    -- llegó una parte
  'recibida',   -- llegó todo
  'cancelada'
);

create table ordenes_compra (
  id              uuid primary key default gen_random_uuid(),
  organizacion_id uuid not null references organizaciones(id) on delete cascade,
  sucursal_id     uuid references sucursales(id) on delete set null,
  proveedor_id    uuid not null references proveedores(id) on delete restrict,
  fecha           date not null default current_date,
  estado          estado_orden not null default 'borrador',
  notas           text,
  creada_por      uuid,
  creada_en       timestamptz not null default now()
);
create index on ordenes_compra (organizacion_id);
create index on ordenes_compra (organizacion_id, estado);

create table orden_items (
  id                       uuid primary key default gen_random_uuid(),
  organizacion_id          uuid not null references organizaciones(id) on delete cascade,
  orden_id                 uuid not null references ordenes_compra(id) on delete cascade,
  insumo_id                uuid not null references insumos(id) on delete restrict,
  cantidad                 numeric(14,4) not null check (cantidad > 0),
  unidad_id                uuid not null references unidades(id),
  precio_unitario_estimado numeric(14,4),
  unique (orden_id, insumo_id)
);
create index on orden_items (organizacion_id);
create index on orden_items (orden_id);

-- ---------------------------------------------------------------------------
-- Recepciones
-- ---------------------------------------------------------------------------

create table recepciones (
  id                uuid primary key default gen_random_uuid(),
  organizacion_id   uuid not null references organizaciones(id) on delete cascade,
  orden_id          uuid not null references ordenes_compra(id) on delete cascade,
  fecha             date not null default current_date,
  -- Actualizar la lista de precios es una DECISIÓN, no un efecto secundario.
  -- Una compra de urgencia más cara no debe recostear el menú entero solo
  -- porque alguien cargó el remito.
  actualiza_precios boolean not null default false,
  notas             text,
  confirmada_en     timestamptz,
  recibida_por      uuid,
  creada_en         timestamptz not null default now()
);
create index on recepciones (organizacion_id);
create index on recepciones (orden_id);

create table recepcion_items (
  id              uuid primary key default gen_random_uuid(),
  organizacion_id uuid not null references organizaciones(id) on delete cascade,
  recepcion_id    uuid not null references recepciones(id) on delete cascade,
  orden_item_id   uuid not null references orden_items(id) on delete restrict,
  cantidad        numeric(14,4) not null check (cantidad > 0),
  unidad_id       uuid not null references unidades(id),
  costo_total     numeric(14,4) not null check (costo_total >= 0),
  unique (recepcion_id, orden_item_id)
);
create index on recepcion_items (organizacion_id);

-- La compra generada guarda de qué recepción salió, para poder auditarla.
alter table compras
  add column if not exists recepcion_id uuid references recepciones(id) on delete set null;

-- ---------------------------------------------------------------------------
-- Confirmar una recepción
-- ---------------------------------------------------------------------------

-- Genera las compras, opcionalmente actualiza los precios de referencia, y
-- recalcula el estado de la orden comparando lo recibido acumulado contra lo
-- pedido.
create or replace function confirmar_recepcion(p_recepcion_id uuid)
returns table (compras_generadas integer, estado_orden text)
language plpgsql
as $$
declare
  r           recepciones%rowtype;
  o           ordenes_compra%rowtype;
  v_generadas integer;
  v_estado    estado_orden;
  v_pendiente boolean;
begin
  select * into r from recepciones where id = p_recepcion_id;
  if not found then
    raise exception 'recepción % inexistente o sin acceso', p_recepcion_id;
  end if;
  if r.confirmada_en is not null then
    raise exception 'la recepción ya fue confirmada el %', r.confirmada_en;
  end if;
  if not exists (select 1 from recepcion_items where recepcion_id = p_recepcion_id) then
    raise exception 'no se puede confirmar una recepción sin ítems';
  end if;

  select * into o from ordenes_compra where id = r.orden_id;
  if o.estado = 'cancelada' then
    raise exception 'la orden está cancelada';
  end if;

  -- 1. Las compras: es lo que hace que la mercadería entre al cálculo de
  --    consumo real de la varianza.
  with generadas as (
    insert into compras (organizacion_id, sucursal_id, proveedor_id, insumo_id,
                         fecha, cantidad, unidad_id, costo_total, recepcion_id, notas)
    select r.organizacion_id, o.sucursal_id, o.proveedor_id, oi.insumo_id,
           r.fecha, ri.cantidad, ri.unidad_id, ri.costo_total, r.id,
           'Recepción de orden ' || left(o.id::text, 8)
    from recepcion_items ri
    join orden_items oi on oi.id = ri.orden_item_id
    where ri.recepcion_id = p_recepcion_id
    returning 1
  )
  select count(*)::int into v_generadas from generadas;

  -- 2. Los precios, solo si se pidió explícitamente.
  if r.actualiza_precios then
    insert into precios_insumo (organizacion_id, insumo_id, proveedor_id, precio,
                                cantidad_presentacion, unidad_id, vigente_desde)
    select r.organizacion_id, oi.insumo_id, o.proveedor_id,
           ri.costo_total, ri.cantidad, ri.unidad_id, r.fecha
    from recepcion_items ri
    join orden_items oi on oi.id = ri.orden_item_id
    where ri.recepcion_id = p_recepcion_id;
  end if;

  update recepciones set confirmada_en = now(), recibida_por = auth.uid()
   where id = p_recepcion_id;

  -- 3. Estado de la orden: comparar lo recibido acumulado contra lo pedido,
  --    siempre en la unidad base del insumo (se puede pedir en cajas y recibir
  --    en kilos).
  select exists (
    select 1
    from orden_items oi
    join insumos i on i.id = oi.insumo_id
    left join (
      select ri.orden_item_id,
             sum(app_convertir(ri.cantidad, ri.unidad_id, i2.unidad_base_id, i2.densidad_g_ml)) as recibido
      from recepcion_items ri
      join orden_items oi2 on oi2.id = ri.orden_item_id
      join insumos i2 on i2.id = oi2.insumo_id
      join recepciones re on re.id = ri.recepcion_id and re.confirmada_en is not null
      group by ri.orden_item_id
    ) acum on acum.orden_item_id = oi.id
    where oi.orden_id = r.orden_id
      and coalesce(acum.recibido, 0)
          < app_convertir(oi.cantidad, oi.unidad_id, i.unidad_base_id, i.densidad_g_ml) - 0.0001
  ) into v_pendiente;

  v_estado := case when v_pendiente then 'parcial'::estado_orden else 'recibida'::estado_orden end;
  update ordenes_compra set estado = v_estado where id = r.orden_id;

  return query select v_generadas, v_estado::text;
end
$$;

-- ---------------------------------------------------------------------------
-- Vista de avance
-- ---------------------------------------------------------------------------

create or replace view vista_orden_avance
with (security_invoker = true)
as
select oi.organizacion_id,
       oi.orden_id,
       oi.id            as orden_item_id,
       i.nombre         as insumo,
       u.codigo         as unidad_base,
       round(app_convertir(oi.cantidad, oi.unidad_id, i.unidad_base_id, i.densidad_g_ml), 4) as pedido,
       round(coalesce(sum(
         app_convertir(ri.cantidad, ri.unidad_id, i.unidad_base_id, i.densidad_g_ml)
       ) filter (where re.confirmada_en is not null), 0), 4) as recibido
from orden_items oi
join insumos i  on i.id = oi.insumo_id
join unidades u on u.id = i.unidad_base_id
left join recepcion_items ri on ri.orden_item_id = oi.id
left join recepciones re     on re.id = ri.recepcion_id
group by oi.organizacion_id, oi.orden_id, oi.id, i.nombre, u.codigo,
         oi.cantidad, oi.unidad_id, i.unidad_base_id, i.densidad_g_ml;

grant select on vista_orden_avance to public;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

do $$
declare t record; pol text;
begin
  for t in
    select * from (values
      ('ordenes_compra',  $r$array['propietario','gerente','compras']$r$),
      ('orden_items',     $r$array['propietario','gerente','compras']$r$),
      ('recepciones',     $r$array['propietario','gerente','compras']$r$),
      ('recepcion_items', $r$array['propietario','gerente','compras']$r$)
    ) as v(tabla, roles)
  loop
    execute format('alter table %I enable row level security', t.tabla);
    execute format('alter table %I force row level security', t.tabla);
    for pol in select polname from pg_policy p
               join pg_class c on c.oid = p.polrelid where c.relname = t.tabla
    loop
      execute format('drop policy if exists %I on %I', pol, t.tabla);
    end loop;
    execute format(
      'create policy %I on %I for select using (organizacion_id in (select app_organizaciones_del_usuario()))',
      t.tabla || '_lectura', t.tabla);
    execute format(
      'create policy %I on %I for all
         using      (organizacion_id in (select app_organizaciones_con_rol(%s::rol_miembro[])))
         with check (organizacion_id in (select app_organizaciones_con_rol(%s::rol_miembro[])))',
      t.tabla || '_escritura', t.tabla, t.roles, t.roles);
  end loop;
end $$;
