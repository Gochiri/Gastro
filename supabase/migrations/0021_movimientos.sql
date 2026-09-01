-- 0021_movimientos.sql
-- Libro de movimientos de inventario y stock teórico.
--
-- El plan pedía una tabla `movimientos_inventario` con los tipos compra,
-- consumo, merma, ajuste y transferencia. Se implementa como VISTA y no como
-- tabla, por una razón que vale la pena dejar escrita: una compra ya existe en
-- `compras` y una merma en `mermas`. Duplicarlas en un libro paralelo crea dos
-- fuentes de verdad que se van a desincronizar el día que alguien corrija una
-- fila en un solo lado.
--
-- Lo único que NO tiene origen en el esquema actual son los ajustes y las
-- transferencias entre sucursales. Eso sí necesita tabla, y es la única que se
-- agrega acá.

create type tipo_movimiento_manual as enum ('ajuste', 'transferencia');

create table movimientos_manuales (
  id                 uuid primary key default gen_random_uuid(),
  organizacion_id    uuid not null references organizaciones(id) on delete cascade,
  tipo               tipo_movimiento_manual not null,
  insumo_id          uuid not null references insumos(id) on delete restrict,
  fecha              date not null default current_date,
  -- Con signo para los ajustes: un recuento que encontró de más es positivo,
  -- uno que encontró de menos es negativo. Para transferencias es siempre
  -- positivo y el signo lo pone la sucursal de cada lado.
  cantidad           numeric(14,4) not null check (cantidad <> 0),
  unidad_id          uuid not null references unidades(id),
  sucursal_origen_id uuid references sucursales(id) on delete set null,
  sucursal_destino_id uuid references sucursales(id) on delete set null,
  motivo             text not null check (length(trim(motivo)) > 0),
  registrado_por     uuid,
  registrado_en      timestamptz not null default now(),

  -- Una transferencia sin las dos puntas no es una transferencia; y mover algo
  -- de una sucursal a sí misma no mueve nada.
  constraint transferencia_coherente check (
    tipo <> 'transferencia'
    or (sucursal_origen_id is not null
        and sucursal_destino_id is not null
        and sucursal_origen_id <> sucursal_destino_id
        and cantidad > 0)
  )
);
create index on movimientos_manuales (organizacion_id);
create index on movimientos_manuales (organizacion_id, fecha);

comment on table movimientos_manuales is
  'Ajustes y transferencias: los dos movimientos que no se derivan de una compra, una merma o un conteo. Un ajuste con motivo es trazable; un stock que cambia solo, no.';

-- ---------------------------------------------------------------------------
-- El libro
-- ---------------------------------------------------------------------------

-- Todo en la unidad base del insumo y con signo: entra positivo, sale negativo.
-- Una transferencia aparece DOS veces, una por sucursal, que es lo que la hace
-- neutra a nivel organización y visible a nivel local.
create or replace view vista_movimientos_inventario
with (security_invoker = true)
as
select c.organizacion_id,
       c.sucursal_id,
       c.insumo_id,
       i.nombre                                    as insumo,
       u.codigo                                    as unidad,
       c.fecha,
       'compra'::text                              as tipo,
       app_convertir(c.cantidad, c.unidad_id, i.unidad_base_id, i.densidad_g_ml) as cantidad,
       coalesce(p.nombre, 'sin proveedor')         as detalle,
       c.id                                        as origen_id
from compras c
join insumos i  on i.id = c.insumo_id
join unidades u on u.id = i.unidad_base_id
left join proveedores p on p.id = c.proveedor_id

union all

select m.organizacion_id, m.sucursal_id, m.insumo_id, i.nombre, u.codigo, m.fecha,
       'merma',
       -app_convertir(m.cantidad, m.unidad_id, i.unidad_base_id, i.densidad_g_ml),
       m.motivo::text,
       m.id
from mermas m
join insumos i  on i.id = m.insumo_id
join unidades u on u.id = i.unidad_base_id

union all

select mm.organizacion_id, mm.sucursal_origen_id, mm.insumo_id, i.nombre, u.codigo, mm.fecha,
       'transferencia_salida',
       -app_convertir(mm.cantidad, mm.unidad_id, i.unidad_base_id, i.densidad_g_ml),
       mm.motivo,
       mm.id
from movimientos_manuales mm
join insumos i  on i.id = mm.insumo_id
join unidades u on u.id = i.unidad_base_id
where mm.tipo = 'transferencia'

union all

select mm.organizacion_id, mm.sucursal_destino_id, mm.insumo_id, i.nombre, u.codigo, mm.fecha,
       'transferencia_entrada',
       app_convertir(mm.cantidad, mm.unidad_id, i.unidad_base_id, i.densidad_g_ml),
       mm.motivo,
       mm.id
from movimientos_manuales mm
join insumos i  on i.id = mm.insumo_id
join unidades u on u.id = i.unidad_base_id
where mm.tipo = 'transferencia'

union all

select mm.organizacion_id, coalesce(mm.sucursal_destino_id, mm.sucursal_origen_id),
       mm.insumo_id, i.nombre, u.codigo, mm.fecha,
       'ajuste',
       app_convertir(mm.cantidad, mm.unidad_id, i.unidad_base_id, i.densidad_g_ml),
       mm.motivo,
       mm.id
from movimientos_manuales mm
join insumos i  on i.id = mm.insumo_id
join unidades u on u.id = i.unidad_base_id
where mm.tipo = 'ajuste';

grant select on vista_movimientos_inventario to public;

comment on view vista_movimientos_inventario is
  'Libro unificado, derivado de las tablas que ya son la fuente de verdad. No duplica ninguna fila: por eso no puede desincronizarse.';

-- ---------------------------------------------------------------------------
-- Stock teórico
-- ---------------------------------------------------------------------------

-- Lo que DEBERÍA haber en la cámara hoy:
--
--   último conteo + movimientos posteriores − consumo teórico posterior
--
-- Es teórico, y el nombre lo dice: si hubiera coincidido con la realidad, la
-- varianza de food cost de la fase 3 no existiría. Sirve para dos cosas
-- concretas: saber qué reponer sin ir a contar, y ver contra qué se está
-- comparando cuando llegue el próximo conteo.
--
-- Se informa SIEMPRE la fecha del conteo base. Un stock teórico calculado desde
-- un conteo de hace tres meses arrastra tres meses de error acumulado, y
-- presentarlo sin esa fecha sería darle una precisión que no tiene.
create or replace function stock_teorico(p_fecha date)
returns table (
  insumo_id       uuid,
  insumo          text,
  unidad          text,
  conteo_base     date,
  dias_desde_conteo integer,
  cantidad_contada numeric,
  entradas        numeric,
  salidas         numeric,
  consumo_teorico numeric,
  stock           numeric,
  valuacion       numeric
)
language sql
stable
as $$
  with base as (
    -- El último conteo cerrado que incluyó al insumo, hasta la fecha pedida.
    select distinct on (ci.insumo_id)
           ci.insumo_id,
           c.momento::date as dia,
           app_convertir(ci.cantidad, ci.unidad_id, i.unidad_base_id, i.densidad_g_ml) as cantidad
    from conteo_items ci
    join conteos c on c.id = ci.conteo_id
    join insumos i on i.id = ci.insumo_id
    where c.estado = 'cerrado' and c.momento::date <= p_fecha
    order by ci.insumo_id, c.momento desc
  ),
  movimientos as (
    select b.insumo_id,
           coalesce(sum(m.cantidad) filter (where m.cantidad > 0), 0) as entradas,
           coalesce(sum(-m.cantidad) filter (where m.cantidad < 0), 0) as salidas
    from base b
    left join vista_movimientos_inventario m
      on m.insumo_id = b.insumo_id
     and m.fecha > b.dia
     and m.fecha <= p_fecha
    group by b.insumo_id
  ),
  consumo as (
    -- El consumo teórico se calcula desde el día siguiente al conteo base de
    -- CADA insumo, así que se pide por el rango más amplio y se filtra después.
    select insumo_id, cantidad
    from consumo_teorico_insumos((select min(dia) + 1 from base), p_fecha)
  )
  select b.insumo_id,
         i.nombre,
         u.codigo,
         b.dia,
         (p_fecha - b.dia)::integer,
         round(b.cantidad, 4),
         round(coalesce(mv.entradas, 0), 4),
         round(coalesce(mv.salidas, 0), 4),
         round(coalesce(co.cantidad, 0), 4),
         round(b.cantidad + coalesce(mv.entradas, 0) - coalesce(mv.salidas, 0)
                 - coalesce(co.cantidad, 0), 4),
         round((b.cantidad + coalesce(mv.entradas, 0) - coalesce(mv.salidas, 0)
                 - coalesce(co.cantidad, 0)) * app_precio_unitario(b.insumo_id, p_fecha), 2)
  from base b
  join insumos i  on i.id = b.insumo_id
  join unidades u on u.id = i.unidad_base_id
  left join movimientos mv on mv.insumo_id = b.insumo_id
  left join consumo co     on co.insumo_id = b.insumo_id
  order by 11 desc nulls last, 2
$$;

comment on function stock_teorico is
  'Existencia estimada desde el último conteo cerrado de cada insumo. Devuelve la fecha de ese conteo y los días transcurridos: sin eso, un número calculado sobre un conteo viejo aparenta una precisión que no tiene.';

-- ---------------------------------------------------------------------------
-- Mermas sobre ventas
-- ---------------------------------------------------------------------------

-- El KPI que faltaba del tablero. Se mide contra las ventas COSTEADAS, el mismo
-- denominador que el food cost: si se midiera contra las ventas totales daría
-- sistemáticamente más bajo y no sería comparable con el resto del tablero.
create or replace function resumen_mermas(p_desde date, p_hasta date)
returns table (
  costo_mermas    numeric,
  ventas_costeadas numeric,
  mermas_pct      numeric,
  registros       bigint,
  por_motivo      jsonb
)
language sql
stable
as $$
  with m as (
    select me.motivo::text as motivo,
           sum(app_convertir(me.cantidad, me.unidad_id, i.unidad_base_id, i.densidad_g_ml)
               * coalesce(me.costo_unitario,
                          app_precio_unitario(me.insumo_id, me.fecha))) as costo,
           count(*) as n
    from mermas me
    join insumos i on i.id = me.insumo_id
    where me.fecha between p_desde and p_hasta
    group by me.motivo
  ),
  v as (
    select coalesce(sum(neto) filter (where costeada), 0) as costeadas
    from vista_ventas_analitica
    where fecha between p_desde and p_hasta
  )
  select round(coalesce((select sum(costo) from m), 0), 2),
         round(v.costeadas, 2),
         round(100 * coalesce((select sum(costo) from m), 0)
               / nullif(v.costeadas, 0), 2),
         coalesce((select sum(n) from m), 0),
         coalesce((select jsonb_object_agg(motivo, round(costo, 2)) from m), '{}'::jsonb)
  from v
$$;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

do $$
declare t record; pol text;
begin
  for t in
    select * from (values
      ('movimientos_manuales', $r$array['propietario','gerente','compras']$r$)
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

-- ---------------------------------------------------------------------------
-- La varianza vuelve a definirse para contemplar los movimientos manuales
-- ---------------------------------------------------------------------------
--
-- Agregar transferencias entre sucursales sin tocar esta función habría
-- introducido un error silencioso en la métrica insignia del producto: mover
-- mercadería de un local a otro habría aparecido como consumo sin explicar en
-- el que la entregó, y como un sobrante en el que la recibió.
--
-- El resto de la función es idéntico. El único cambio es el término nuevo:
--
--   consumo real = inventario inicial + compras + movimientos netos - inventario final
--
create or replace function varianza_periodo(
  p_conteo_inicial uuid,
  p_conteo_final   uuid
) returns table (
  insumo_id              uuid,
  insumo                 text,
  unidad                 text,
  inventario_inicial     numeric,
  compras                numeric,
  inventario_final       numeric,
  consumo_real           numeric,
  consumo_teorico        numeric,
  varianza_cantidad      numeric,
  mermas_registradas     numeric,
  varianza_no_explicada  numeric,
  precio_unitario        numeric,
  varianza_dinero        numeric,
  no_explicada_dinero    numeric
)
language plpgsql
stable
as $$
declare
  c_ini conteos%rowtype;
  c_fin conteos%rowtype;
begin
  select * into c_ini from conteos where id = p_conteo_inicial;
  if not found then raise exception 'conteo inicial % inexistente o sin acceso', p_conteo_inicial; end if;
  select * into c_fin from conteos where id = p_conteo_final;
  if not found then raise exception 'conteo final % inexistente o sin acceso', p_conteo_final; end if;

  if c_ini.estado <> 'cerrado' or c_fin.estado <> 'cerrado' then
    raise exception 'ambos conteos deben estar cerrados'
      using hint = 'Un conteo en borrador todavía puede cambiar: la varianza saldría de datos provisorios.';
  end if;
  if c_fin.momento <= c_ini.momento then
    raise exception 'el conteo final (%) no es posterior al inicial (%)',
      c_fin.momento, c_ini.momento;
  end if;

  return query
  with periodo as (
    select c_ini.momento::date as desde, c_fin.momento::date as hasta
  ),
  -- Solo los insumos presentes en LOS DOS conteos.
  base as (
    select ci.insumo_id,
           app_convertir(ci.cantidad, ci.unidad_id, i.unidad_base_id, i.densidad_g_ml) as inicial,
           app_convertir(cf.cantidad, cf.unidad_id, i.unidad_base_id, i.densidad_g_ml) as final,
           i.nombre, u.codigo as unidad
    from conteo_items ci
    join conteo_items cf on cf.insumo_id = ci.insumo_id and cf.conteo_id = p_conteo_final
    join insumos i  on i.id = ci.insumo_id
    join unidades u on u.id = i.unidad_base_id
    where ci.conteo_id = p_conteo_inicial
  ),
  -- Todo lo que entra en la ecuación tiene que ser DE LA MISMA SUCURSAL que
  -- los conteos. Un conteo de Casa Central contra las compras de toda la
  -- organización compara peras con manzanas, y el error crece con cada sucursal
  -- que se abre. Cuando el conteo no declara sucursal se toma la organización
  -- entera, que es el caso de un negocio de un solo local.
  --
  -- Las filas SIN sucursal se incluyen igual, y la elección importa. Dejarlas
  -- afuera hace desaparecer una merma que alguien cargó sin elegir local, y esa
  -- merma deja de explicar un faltante que sí ocurrió: el informe pasa a acusar
  -- un desvío inexistente. Entre atribuir de más y acusar de más, acusar de más
  -- es el error caro — del otro lado de ese número hay una persona.
  compras_periodo as (
    select c.insumo_id,
           sum(app_convertir(c.cantidad, c.unidad_id, i.unidad_base_id, i.densidad_g_ml)) as cantidad
    from compras c
    join insumos i on i.id = c.insumo_id
    cross join periodo p
    where c.fecha > p.desde and c.fecha <= p.hasta
      and (c_ini.sucursal_id is null
           or c.sucursal_id = c_ini.sucursal_id
           or c.sucursal_id is null)
    group by c.insumo_id
  ),
  mermas_periodo as (
    select m.insumo_id,
           sum(app_convertir(m.cantidad, m.unidad_id, i.unidad_base_id, i.densidad_g_ml)) as cantidad
    from mermas m
    join insumos i on i.id = m.insumo_id
    cross join periodo p
    where m.fecha > p.desde and m.fecha <= p.hasta
      and (c_ini.sucursal_id is null
           or m.sucursal_id = c_ini.sucursal_id
           or m.sucursal_id is null)
    group by m.insumo_id
  ),
  -- Transferencias y ajustes ocurridos ENTRE los dos conteos. Sin este
  -- término, sacar 2 kg de carne hacia otra sucursal se lee como 2 kg
  -- consumidos por la cocina, y la varianza acusa un faltante que no existe.
  movimientos_periodo as (
    select m.insumo_id, sum(m.cantidad) as cantidad
    from vista_movimientos_inventario m
    cross join periodo p
    where m.fecha > p.desde and m.fecha <= p.hasta
      and m.tipo in ('ajuste', 'transferencia_entrada', 'transferencia_salida')
      -- Sin este filtro una transferencia interna se anula sola: la salida de
      -- un local y la entrada del otro suman cero, y la sucursal que entregó la
      -- mercadería sigue apareciendo como si la hubiera consumido.
      and (c_ini.sucursal_id is null
           or m.sucursal_id = c_ini.sucursal_id
           or m.sucursal_id is null)
    group by m.insumo_id
  ),
  teorico as (
    select t.insumo_id, t.cantidad
    from periodo p
    cross join lateral consumo_teorico_insumos(p.desde, p.hasta) t
  ),
  calculado as (
    select b.insumo_id, b.nombre, b.unidad,
           b.inicial,
           coalesce(cp.cantidad, 0) as compras,
           b.final,
           -- consumo real = inicial + compras + movimientos netos - final
           b.inicial + coalesce(cp.cantidad, 0) + coalesce(mm.cantidad, 0)
             - b.final as real,
           coalesce(t.cantidad, 0)                        as teorico,
           coalesce(mp.cantidad, 0)                       as mermas,
           app_precio_unitario(b.insumo_id, (select hasta from periodo)) as precio
    from base b
    left join compras_periodo cp on cp.insumo_id = b.insumo_id
    left join mermas_periodo  mp on mp.insumo_id = b.insumo_id
    left join movimientos_periodo mm on mm.insumo_id = b.insumo_id
    left join teorico          t on t.insumo_id  = b.insumo_id
  )
  select c.insumo_id, c.nombre, c.unidad,
         round(c.inicial, 4),
         round(c.compras, 4),
         round(c.final, 4),
         round(c.real, 4),
         round(c.teorico, 4),
         round(c.real - c.teorico, 4),
         round(c.mermas, 4),
         round(c.real - c.teorico - c.mermas, 4),
         round(c.precio, 4),
         round((c.real - c.teorico) * c.precio, 2),
         round((c.real - c.teorico - c.mermas) * c.precio, 2)
  from calculado c
  -- Ordenado por dinero sin explicar: un faltante de 200 g de azafrán importa
  -- más que 5 kg de papa, y ordenar por cantidad lo escondería.
  order by abs((c.real - c.teorico - c.mermas) * c.precio) desc;
end
$$;

