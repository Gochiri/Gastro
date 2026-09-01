-- 0007_kpis.sql
-- Métricas de venta. Todo se calcula aquí; la aplicación solo formatea.
--
-- Definiciones, para que no queden a interpretación:
--   neto      = importe_bruto - descuento          (lo que pagó el cliente)
--   comision  = neto * comision_pct_aplicada / 100 (lo que retiene el canal)
--   costo     = cantidad * costo_unitario_teorico  (materia prima)
--   margen    = neto - comision - costo            (margen de contribución)
--
-- La comisión NO reduce las ventas: reduce el margen. Un plato puede tener
-- ventas sanas y margen negativo si el canal se lleva 28%.

create or replace view vista_ventas_analitica
with (security_invoker = true)
as
select v.id,
       v.organizacion_id,
       v.fecha,
       v.cantidad,
       p.id     as producto_id,
       p.nombre as producto,
       p.categoria,
       c.id     as canal_id,
       c.nombre as canal,
       v.importe_bruto - v.descuento                                   as neto,
       (v.importe_bruto - v.descuento) * v.comision_pct_aplicada / 100 as comision,
       v.cantidad * v.costo_unitario_teorico                           as costo,
       (v.importe_bruto - v.descuento)
         - (v.importe_bruto - v.descuento) * v.comision_pct_aplicada / 100
         - coalesce(v.cantidad * v.costo_unitario_teorico, 0)          as margen,
       (v.costo_unitario_teorico is not null)                          as costeada,
       v.costeada_en
from ventas v
join productos p on p.id = v.producto_id
join canales   c on c.id = v.canal_id;

comment on view vista_ventas_analitica is
  'Una fila por línea de venta con su margen ya calculado. El margen de una venta sin costo se calcula como si el costo fuese cero, pero la columna `costeada` permite excluirla: nunca mezclar ambos criterios en un mismo número.';

-- ---------------------------------------------------------------------------
-- Resumen del período
-- ---------------------------------------------------------------------------

create or replace function resumen_ventas(p_desde date, p_hasta date)
returns table (
  ventas_brutas      numeric,
  comisiones         numeric,
  costo_teorico      numeric,
  margen             numeric,
  food_cost_pct      numeric,
  margen_pct         numeric,
  cobertura_pct      numeric,
  unidades           numeric,
  tickets            bigint,
  ticket_promedio    numeric
)
language sql
stable
as $$
  with base as (
    select * from vista_ventas_analitica
    where fecha between p_desde and p_hasta
  )
  select
    round(coalesce(sum(neto), 0), 2),
    round(coalesce(sum(comision), 0), 2),
    round(coalesce(sum(costo), 0), 2),
    round(coalesce(sum(margen), 0), 2),
    -- Food cost sobre las ventas COSTEADAS, no sobre el total: dividir un costo
    -- parcial por ventas completas daría un porcentaje falsamente bajo.
    round(100 * coalesce(sum(costo), 0)
              / nullif(sum(neto) filter (where costeada), 0), 2),
    round(100 * coalesce(sum(margen), 0) / nullif(sum(neto), 0), 2),
    -- Qué proporción de las ventas tiene costo conocido. Es la métrica de
    -- honestidad: sin ella, un food cost calculado sobre el 40% del negocio
    -- parece un dato del negocio entero.
    round(100 * coalesce(sum(neto) filter (where costeada), 0)
              / nullif(sum(neto), 0), 2),
    round(coalesce(sum(cantidad), 0), 2),
    count(*),
    round(coalesce(sum(neto), 0) / nullif(count(*), 0), 2)
  from base
$$;

-- ---------------------------------------------------------------------------
-- Margen por producto y canal
-- ---------------------------------------------------------------------------

create or replace view vista_margen_producto_canal
with (security_invoker = true)
as
select organizacion_id,
       producto_id,
       producto,
       canal_id,
       canal,
       sum(cantidad)                            as unidades,
       round(sum(neto), 2)                      as ventas,
       round(sum(comision), 2)                  as comisiones,
       round(sum(costo), 2)                     as costo,
       round(sum(margen), 2)                    as margen,
       round(100 * sum(margen) / nullif(sum(neto), 0), 2) as margen_pct,
       bool_and(costeada)                       as costeado_completo
from vista_ventas_analitica
group by organizacion_id, producto_id, producto, canal_id, canal;

comment on view vista_margen_producto_canal is
  'El mismo plato aparece una vez por canal. Comparar sus filas es lo que revela que un producto rentable en salón pierde dinero por delivery.';

-- Agregado por producto, sumando todos los canales.
create or replace view vista_margen_producto
with (security_invoker = true)
as
select organizacion_id,
       producto_id,
       producto,
       sum(unidades)                                        as unidades,
       sum(ventas)                                          as ventas,
       sum(margen)                                          as margen,
       round(100 * sum(margen) / nullif(sum(ventas), 0), 2) as margen_pct,
       bool_and(costeado_completo)                          as costeado_completo
from vista_margen_producto_canal
group by organizacion_id, producto_id, producto;

grant select on vista_ventas_analitica, vista_margen_producto_canal, vista_margen_producto to public;
