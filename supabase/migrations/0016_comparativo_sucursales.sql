-- 0016_comparativo_sucursales.sql
-- Comparativo entre sucursales.
--
-- Con una sola sucursal, el resultado del negocio es el resultado del local.
-- Con dos, el promedio miente: una sucursal sana puede estar financiando a
-- otra que pierde plata, y en el consolidado eso no se ve.

-- El fichaje ya guardaba la sucursal; la vista no la exponía. Se agrega al
-- final para no romper el orden de columnas existente.
create or replace view vista_fichajes
with (security_invoker = true)
as
select f.id,
       f.organizacion_id,
       f.empleado_id,
       e.nombre  as empleado,
       e.puesto,
       f.entrada,
       f.salida,
       f.fecha_operativa                            as fecha,
       app_horas_fichaje(f.entrada, f.salida)       as horas,
       f.costo_hora_aplicado,
       f.cargas_pct_aplicado,
       round(
         app_horas_fichaje(f.entrada, f.salida)
           * f.costo_hora_aplicado
           * (1 + coalesce(f.cargas_pct_aplicado, 0) / 100),
         2
       )                                            as costo,
       (f.salida is null)                           as abierto,
       f.sucursal_id
from fichajes f
join empleados e on e.id = f.empleado_id;

grant select on vista_fichajes to public;

-- ---------------------------------------------------------------------------
-- Comparativo
-- ---------------------------------------------------------------------------

-- Prorrateo de los gastos de organización (la contadora, el seguro, el
-- software) entre sucursales: POR PARTICIPACIÓN EN LAS VENTAS.
--
-- Es una convención, no una verdad, y por eso se informa en columna aparte de
-- los gastos asignados directamente. Quien mire el número tiene que poder ver
-- cuánto de la pérdida de una sucursal es suya y cuánto le llegó repartido.
--
-- Si la organización no vendió nada en el período no hay participación que
-- calcular, y se reparte en partes iguales: es arbitrario, pero dejar los
-- gastos sin repartir haría que la suma de las sucursales no diera el
-- resultado de la organización, y un comparativo que no cierra no sirve.
--
-- Invariante que se verifica en los tests: la suma de los EBITDA por sucursal
-- es exactamente el EBITDA de la organización.
create or replace function comparativo_sucursales(p_desde date, p_hasta date)
returns table (
  sucursal_id             uuid,
  sucursal                text,
  ventas                  numeric,
  comisiones              numeric,
  costo_comida            numeric,
  costo_laboral           numeric,
  margen_contribucion     numeric,
  margen_contribucion_pct numeric,
  ventas_costeadas        numeric,
  cobertura_costeo_pct    numeric,
  food_cost_pct           numeric,
  labor_cost_pct          numeric,
  prime_cost_pct          numeric,
  gastos_asignados        numeric,
  gastos_prorrateados     numeric,
  ebitda                  numeric,
  ebitda_pct              numeric,
  horas                   numeric,
  fichajes_abiertos       bigint,
  participacion_pct       numeric
)
language sql
stable
as $$
  with ventas_suc as (
    select v.sucursal_id,
           sum(a.neto)                                as neto,
           sum(a.comision)                            as comision,
           sum(a.costo)                               as costo,
           sum(a.neto) filter (where a.costeada)      as costeadas
    from vista_ventas_analitica a
    join ventas v on v.id = a.id
    where a.fecha between p_desde and p_hasta
    group by v.sucursal_id
  ),
  trabajo_suc as (
    select f.sucursal_id,
           sum(f.costo) filter (where not f.abierto) as costo,
           sum(f.horas) filter (where not f.abierto) as horas,
           count(*) filter (where f.abierto)         as abiertos
    from vista_fichajes f
    where f.fecha between p_desde and p_hasta
    group by f.sucursal_id
  ),
  gastos_suc as (
    select g.sucursal_id,
           sum(g.importe) filter (where g.en_ebitda) as asignados
    from gastos_fijos_devengados(p_desde, p_hasta) g
    where g.sucursal_id is not null
    group by g.sucursal_id
  ),
  gastos_org as (
    select coalesce(sum(g.importe) filter (where g.en_ebitda), 0) as a_repartir
    from gastos_fijos_devengados(p_desde, p_hasta) g
    where g.sucursal_id is null
  ),
  -- Filas del comparativo: toda sucursal con algo que mostrar, más la fila
  -- "sin asignar" si hay ventas, trabajo o gastos sin sucursal.
  filas as (
    select sucursal_id from ventas_suc
    union select sucursal_id from trabajo_suc
    union select sucursal_id from gastos_suc
  ),
  base as (
    select f.sucursal_id,
           coalesce(s.nombre, 'Sin asignar')            as nombre,
           coalesce(v.neto, 0)                          as neto,
           coalesce(v.comision, 0)                      as comision,
           coalesce(v.costo, 0)                         as costo,
           coalesce(v.costeadas, 0)                     as costeadas,
           coalesce(t.costo, 0)                         as laboral,
           coalesce(t.horas, 0)                         as horas,
           coalesce(t.abiertos, 0)                      as abiertos,
           coalesce(gs.asignados, 0)                    as asignados
    from filas f
    left join sucursales  s  on s.id = f.sucursal_id
    left join ventas_suc  v  on v.sucursal_id is not distinct from f.sucursal_id
    left join trabajo_suc t  on t.sucursal_id is not distinct from f.sucursal_id
    left join gastos_suc  gs on gs.sucursal_id is not distinct from f.sucursal_id
  ),
  total as (
    select sum(neto) as neto_total, count(*) as filas from base
  ),
  repartido as (
    select b.*,
           o.a_repartir,
           case when tt.neto_total > 0 then b.neto / tt.neto_total
                else 1.0 / nullif(tt.filas, 0)
           end as participacion
    from base b, gastos_org o, total tt
  )
  select r.sucursal_id,
         r.nombre,
         round(r.neto, 2),
         round(r.comision, 2),
         round(r.costo, 2),
         round(r.laboral, 2),
         round(r.neto - r.comision - r.costo - r.laboral, 2),
         round(100 * (r.neto - r.comision - r.costo - r.laboral) / nullif(r.neto, 0), 2),
         round(r.costeadas, 2),
         round(100 * r.costeadas / nullif(r.neto, 0), 2),
         -- Mismo criterio que en todo el sistema: el food cost se mide contra
         -- las ventas COSTEADAS, no contra el total.
         round(100 * r.costo / nullif(r.costeadas, 0), 2),
         round(100 * r.laboral / nullif(r.costeadas, 0), 2),
         round(100 * (r.costo + r.laboral) / nullif(r.costeadas, 0), 2),
         round(r.asignados, 2),
         round(r.a_repartir * r.participacion, 2),
         round(r.neto - r.comision - r.costo - r.laboral
                 - r.asignados - r.a_repartir * r.participacion, 2),
         round(100 * (r.neto - r.comision - r.costo - r.laboral
                 - r.asignados - r.a_repartir * r.participacion)
               / nullif(r.neto, 0), 2),
         round(r.horas, 2),
         r.abiertos,
         round(100 * r.participacion, 2)
  from repartido r
  order by 3 desc, 2
$$;

comment on function comparativo_sucursales is
  'Una fila por sucursal con actividad en el período. Los gastos de organización se reparten por participación en las ventas y se informan en columna separada de los asignados: quien lea el número tiene que poder distinguir la pérdida propia de la que le llegó prorrateada.';
