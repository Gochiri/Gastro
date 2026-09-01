-- 0008_inventario.sql
-- Compras, conteos de inventario y mermas: los tres datos que faltan para
-- calcular el consumo REAL y compararlo con el teórico.
--
--   consumo real = inventario inicial + compras − inventario final
--
-- Las compras estaban planificadas para una fase posterior, pero sin ese término
-- la ecuación no cierra. Acá va un registro manual simple; las órdenes de compra
-- con recepción parcial siguen pendientes.

-- ---------------------------------------------------------------------------
-- Compras
-- ---------------------------------------------------------------------------

create table compras (
  id              uuid primary key default gen_random_uuid(),
  organizacion_id uuid not null references organizaciones(id) on delete cascade,
  sucursal_id     uuid references sucursales(id) on delete set null,
  proveedor_id    uuid references proveedores(id) on delete set null,
  insumo_id       uuid not null references insumos(id) on delete restrict,
  fecha           date not null,
  cantidad        numeric(14,4) not null check (cantidad > 0),
  unidad_id       uuid not null references unidades(id),
  costo_total     numeric(14,4) not null check (costo_total >= 0),
  notas           text,
  creada_en       timestamptz not null default now()
);
create index on compras (organizacion_id);
create index on compras (organizacion_id, fecha);
create index on compras (insumo_id, fecha);

comment on table compras is
  'Registrar una compra NO actualiza precios_insumo. Que esta semana la carne saliera más cara no debe recostear el menú entero sin que nadie lo decida: actualizar el precio de referencia es una acción aparte y explícita.';

-- Cantidad comprada en la unidad base del insumo, para poder sumarla al
-- inventario sin repetir la conversión en cada consulta.
create or replace function app_compra_en_base(p_compra_id uuid)
returns numeric
language sql
stable
as $$
  select app_convertir(c.cantidad, c.unidad_id, i.unidad_base_id, i.densidad_g_ml)
  from compras c join insumos i on i.id = c.insumo_id
  where c.id = p_compra_id
$$;

-- ---------------------------------------------------------------------------
-- Conteos de inventario
-- ---------------------------------------------------------------------------

create type tipo_conteo   as enum ('apertura', 'cierre', 'ciclico');
create type estado_conteo as enum ('borrador', 'cerrado');

create table conteos (
  id              uuid primary key default gen_random_uuid(),
  organizacion_id uuid not null references organizaciones(id) on delete cascade,
  sucursal_id     uuid references sucursales(id) on delete set null,
  tipo            tipo_conteo not null default 'ciclico',
  estado          estado_conteo not null default 'borrador',
  -- Momento exacto, no solo el día: dos conteos del mismo día a distinta hora
  -- describen inventarios distintos, y el informe tiene que poder mostrarlo.
  momento         timestamptz not null default now(),
  notas           text,
  creado_por      uuid,
  creado_en       timestamptz not null default now(),
  cerrado_en      timestamptz
);
create index on conteos (organizacion_id);
create index on conteos (organizacion_id, momento);

comment on column conteos.momento is
  'Fecha Y hora del conteo. Dos conteos hechos con la cámara en estados distintos (uno lleno, otro a mitad de reposición) producen una varianza inventada; mostrar el momento permite detectarlo.';

create table conteo_items (
  id                     uuid primary key default gen_random_uuid(),
  organizacion_id        uuid not null references organizaciones(id) on delete cascade,
  conteo_id              uuid not null references conteos(id) on delete cascade,
  insumo_id              uuid not null references insumos(id) on delete restrict,
  cantidad               numeric(14,4) not null check (cantidad >= 0),
  unidad_id              uuid not null references unidades(id),
  -- Congelado al cerrar el conteo, igual que en ventas: un inventario valuado
  -- no debe cambiar de valor porque hoy cambió un precio.
  costo_unitario         numeric(14,4),
  unique (conteo_id, insumo_id)
);
create index on conteo_items (organizacion_id);
create index on conteo_items (conteo_id);

comment on table conteo_items is
  'Se permite contar solo algunos insumos. La varianza se calcula sobre los contados en ambos conteos y el informe declara qué porcentaje del costo cubre.';

-- ---------------------------------------------------------------------------
-- Mermas
-- ---------------------------------------------------------------------------

create type motivo_merma as enum (
  'vencimiento',
  'error_cocina',
  'cortesia',
  'rotura',
  'devolucion',
  'otro'
);

create table mermas (
  id              uuid primary key default gen_random_uuid(),
  organizacion_id uuid not null references organizaciones(id) on delete cascade,
  sucursal_id     uuid references sucursales(id) on delete set null,
  insumo_id       uuid not null references insumos(id) on delete restrict,
  fecha           date not null default current_date,
  cantidad        numeric(14,4) not null check (cantidad > 0),
  unidad_id       uuid not null references unidades(id),
  motivo          motivo_merma not null default 'otro',
  costo_unitario  numeric(14,4),
  notas           text,
  registrada_por  uuid,
  registrada_en   timestamptz not null default now()
);
create index on mermas (organizacion_id);
create index on mermas (organizacion_id, fecha);
create index on mermas (insumo_id, fecha);

comment on table mermas is
  'Lo que se tiró y por qué. Es la parte EXPLICADA de la varianza: sin este registro, todo faltante parece robo.';

-- El costo de una merma se congela al registrarla, con el precio de esa fecha.
create or replace function app_congelar_costo_merma()
returns trigger
language plpgsql
as $$
begin
  if new.costo_unitario is null then
    begin
      new.costo_unitario := app_precio_unitario(new.insumo_id, new.fecha);
    exception when others then
      -- Un insumo sin precio a esa fecha no debe impedir registrar la merma:
      -- el dato operativo (se tiró comida) vale aunque no se pueda valuar.
      new.costo_unitario := null;
    end;
  end if;
  return new;
end
$$;

create trigger mermas_congelar_costo
  before insert on mermas
  for each row execute function app_congelar_costo_merma();

-- ---------------------------------------------------------------------------
-- Cerrar un conteo
-- ---------------------------------------------------------------------------

create or replace function cerrar_conteo(p_conteo_id uuid)
returns integer
language plpgsql
as $$
declare
  v_conteo conteos%rowtype;
  v_items  integer;
begin
  select * into v_conteo from conteos where id = p_conteo_id;
  if not found then
    raise exception 'conteo % inexistente o sin acceso', p_conteo_id;
  end if;
  if v_conteo.estado <> 'borrador' then
    raise exception 'el conteo ya está cerrado';
  end if;

  select count(*) into v_items from conteo_items where conteo_id = p_conteo_id;
  if v_items = 0 then
    raise exception 'no se puede cerrar un conteo sin ningún insumo contado';
  end if;

  -- Valuación congelada al momento del conteo.
  update conteo_items ci
     set costo_unitario = app_precio_unitario(ci.insumo_id, v_conteo.momento::date)
   where ci.conteo_id = p_conteo_id
     and exists (
       select 1 from precios_insumo p
       where p.insumo_id = ci.insumo_id and p.vigente_desde <= v_conteo.momento::date
     );

  update conteos set estado = 'cerrado', cerrado_en = now() where id = p_conteo_id;
  return v_items;
end
$$;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

do $$
declare t record; pol text;
begin
  for t in
    select * from (values
      ('compras',      $r$array['propietario','gerente','compras']$r$),
      ('conteos',      $r$array['propietario','gerente','compras']$r$),
      ('conteo_items', $r$array['propietario','gerente','compras']$r$),
      ('mermas',       $r$array['propietario','gerente','compras']$r$)
    ) as v(tabla, roles)
  loop
    execute format('alter table %I enable row level security', t.tabla);
    execute format('alter table %I force row level security', t.tabla);

    for pol in select polname from pg_policy p
               join pg_class c on c.oid = p.polrelid
               where c.relname = t.tabla
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
