-- 0012_prime_cost.sql
-- Prime cost: comida más trabajo sobre ventas.
--
-- Es la métrica de supervivencia de un restaurante. Por encima del 65% no
-- queda margen para alquiler, servicios y ganancia, por más que las ventas
-- parezcan buenas.

create or replace function resumen_prime_cost(p_desde date, p_hasta date)
returns table (
  ventas_costeadas    numeric,
  costo_comida        numeric,
  costo_laboral       numeric,
  prime_cost          numeric,
  food_cost_pct       numeric,
  labor_cost_pct      numeric,
  prime_cost_pct      numeric,
  horas_trabajadas    numeric,
  fichajes_abiertos   bigint,
  cobertura_costeo_pct numeric
)
language sql
stable
as $$
  with ventas as (
    -- MISMO denominador que resumen_ventas() y resumen_varianza(): ventas con
    -- costo conocido. Tres pantallas que dicen "food cost" con denominadores
    -- distintos dan tres números distintos para lo mismo, y el usuario deja de
    -- creer en los tres.
    select * from resumen_ventas(p_desde, p_hasta)
  ),
  -- El denominador se calcula DIRECTO, no reconstruyéndolo desde el porcentaje
  -- de cobertura: ese viene redondeado a dos decimales y multiplicarlo por las
  -- ventas arrastra el error a todos los porcentajes de abajo.
  costeadas as (
    select coalesce(sum(neto), 0) as neto
    from vista_ventas_analitica
    where fecha between p_desde and p_hasta and costeada
  ),
  trabajo as (
    select * from costo_laboral(p_desde, p_hasta)
  )
  select round(c.neto, 2),
         round(v.costo_teorico, 2),
         round(t.costo_total, 2),
         round(v.costo_teorico + t.costo_total, 2),
         v.food_cost_pct,
         round(100 * t.costo_total / nullif(c.neto, 0), 2),
         round(100 * (v.costo_teorico + t.costo_total) / nullif(c.neto, 0), 2),
         t.horas,
         t.fichajes_abiertos,
         v.cobertura_pct
  from ventas v, costeadas c, trabajo t
$$;

comment on function resumen_prime_cost is
  'Prime cost sobre ventas costeadas, el mismo criterio que el resto del sistema. Los fichajes sin cerrar se informan aparte: no se cuestan, y un costo laboral calculado sobre la mitad de los turnos engaña.';

-- Costo laboral por día, para ver si el personal está bien distribuido contra
-- la demanda. Un lunes con la misma dotación que un sábado es dinero tirado.
create or replace view vista_costo_laboral_diario
with (security_invoker = true)
as
select f.organizacion_id,
       f.fecha,
       count(distinct f.empleado_id)                    as empleados,
       round(sum(f.horas) filter (where not f.abierto), 2) as horas,
       round(sum(f.costo) filter (where not f.abierto), 2) as costo_laboral,
       count(*) filter (where f.abierto)                as fichajes_abiertos
from vista_fichajes f
group by f.organizacion_id, f.fecha;

grant select on vista_costo_laboral_diario to public;
