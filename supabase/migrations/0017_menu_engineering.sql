-- 0017_menu_engineering.sql
-- Matriz de menu engineering (Kasavana-Smith).
--
-- Clasifica cada plato cruzando dos ejes: cuánto se vende y cuánto deja.
--
--                  margen alto        margen bajo
--   popular        ESTRELLA           VACA LECHERA
--   poco popular   ROMPECABEZAS       PERRO
--
-- Cada cuadrante pide una acción distinta, y por eso la clasificación importa:
-- a una estrella no se le toca el precio, a un rompecabezas se le mejora la
-- descripción o la ubicación en la carta, y a un perro se lo saca. Confundir un
-- perro con una vaca lechera lleva a retirar un plato que sostiene el volumen.
--
-- La clasificación se calcula ACÁ, no en el modelo. El widget de IA recibe la
-- matriz ya resuelta y su trabajo es recomendar qué hacer con cada plato.

-- ---------------------------------------------------------------------------
-- Umbrales
-- ---------------------------------------------------------------------------

-- Popularidad: un plato es popular si su participación en unidades supera el
-- 70% de la participación que le tocaría en un reparto parejo. Con 10 platos el
-- reparto parejo es 10% y el umbral 7%. El 0,70 es la constante clásica del
-- método; se deja explícita para poder discutirla, no escondida en la fórmula.
create or replace function app_umbral_popularidad(p_platos integer)
returns numeric
language sql
immutable
as $$
  select case when p_platos > 0 then 0.70 / p_platos end
$$;

-- ---------------------------------------------------------------------------
-- La matriz
-- ---------------------------------------------------------------------------

-- IMPORTANTE: solo entran los productos con ficha técnica.
--
-- Un producto sin receta no tiene margen conocido; meterlo con margen cero lo
-- clasificaría como perro y llevaría a retirar un producto que quizás sea el
-- más rentable del negocio. Tampoco entra en el denominador de popularidad:
-- si entrara, las unidades de un producto que no se puede clasificar bajarían
-- la participación de todos los demás y moverían el umbral.
--
-- Lo que queda afuera se informa en `matriz_menu_cobertura`, y la pantalla lo
-- muestra al lado de la matriz.
drop function if exists matriz_menu(date, date);
create function matriz_menu(p_desde date, p_hasta date)
returns table (
  producto_id        uuid,
  producto           text,
  categoria          text,
  unidades           numeric,
  ventas             numeric,
  costo              numeric,
  margen             numeric,
  margen_unitario    numeric,
  precio_promedio    numeric,
  margen_pct         numeric,
  popularidad_pct    numeric,
  umbral_popularidad_pct numeric,
  margen_referencia  numeric,
  popular            boolean,
  margen_alto        boolean,
  -- Distancia a cada umbral. Una clasificación que se da vuelta con una venta
  -- más no es un veredicto, y la pantalla tiene que poder decirlo.
  distancia_margen   numeric,
  distancia_popularidad numeric,
  clasificacion      text
)
language sql
stable
as $$
  with base as (
    select v.producto_id,
           v.producto,
           v.categoria,
           sum(v.cantidad)  as unidades,
           sum(v.neto)      as ventas,
           sum(v.costo)     as costo,
           sum(v.margen)    as margen
    from vista_ventas_analitica v
    where v.fecha between p_desde and p_hasta
      and v.costeada
    group by v.producto_id, v.producto, v.categoria
    having sum(v.cantidad) > 0
  ),
  totales as (
    select sum(unidades)                      as unidades,
           sum(margen)                        as margen,
           count(*)::integer                  as platos,
           -- Margen de referencia: el margen unitario PONDERADO del conjunto,
           -- no el promedio de los márgenes unitarios. Un plato que se vende
           -- una vez no puede pesar lo mismo que uno que se vende cien veces
           -- al fijar la vara contra la que se mide a todos.
           sum(margen) / nullif(sum(unidades), 0) as margen_unitario_ref
    from base
  ),
  calc as (
    select b.*,
           t.margen_unitario_ref,
           b.unidades / nullif(t.unidades, 0)        as participacion,
           app_umbral_popularidad(t.platos)          as umbral,
           b.margen / nullif(b.unidades, 0)          as margen_unitario
    from base b, totales t
  )
  select c.producto_id,
         c.producto,
         c.categoria,
         round(c.unidades, 2),
         round(c.ventas, 2),
         round(c.costo, 2),
         round(c.margen, 2),
         round(c.margen_unitario, 2),
         round(c.ventas / nullif(c.unidades, 0), 2),
         round(100 * c.margen / nullif(c.ventas, 0), 2),
         round(100 * c.participacion, 2),
         round(100 * c.umbral, 2),
         round(c.margen_unitario_ref, 2),
         c.participacion >= c.umbral,
         c.margen_unitario >= c.margen_unitario_ref,
         round(c.margen_unitario - c.margen_unitario_ref, 2),
         round(100 * (c.participacion - c.umbral), 2),
         case
           when c.participacion >= c.umbral and c.margen_unitario >= c.margen_unitario_ref
             then 'estrella'
           when c.participacion >= c.umbral
             then 'vaca'
           when c.margen_unitario >= c.margen_unitario_ref
             then 'rompecabezas'
           else 'perro'
         end
  from calc c
  order by c.margen desc
$$;

comment on function matriz_menu is
  'Clasificación Kasavana-Smith por período. La comparación de margen es por UNIDAD, no por porcentaje: un plato con 70% de margen sobre $2.000 deja menos que uno con 30% sobre $12.000, y la carta se diseña con pesos, no con porcentajes.';

-- Qué parte del negocio quedó fuera de la matriz. Va siempre junto a ella.
create or replace function matriz_menu_cobertura(p_desde date, p_hasta date)
returns table (
  productos_clasificados   bigint,
  productos_sin_ficha      bigint,
  unidades_clasificadas    numeric,
  unidades_sin_ficha       numeric,
  ventas_clasificadas      numeric,
  ventas_sin_ficha         numeric,
  cobertura_pct            numeric
)
language sql
stable
as $$
  with v as (
    select producto_id, costeada, cantidad, neto
    from vista_ventas_analitica
    where fecha between p_desde and p_hasta
  )
  select count(distinct producto_id) filter (where costeada),
         count(distinct producto_id) filter (where not costeada),
         round(coalesce(sum(cantidad) filter (where costeada), 0), 2),
         round(coalesce(sum(cantidad) filter (where not costeada), 0), 2),
         round(coalesce(sum(neto) filter (where costeada), 0), 2),
         round(coalesce(sum(neto) filter (where not costeada), 0), 2),
         round(100 * coalesce(sum(neto) filter (where costeada), 0)
                   / nullif(sum(neto), 0), 2)
  from v
$$;
