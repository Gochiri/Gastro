-- 0018_anomalias.sql
-- Detección de anomalías.
--
-- DECISIÓN CENTRAL: la detección es SQL, no es el modelo.
--
-- Un detector de anomalías donde el modelo mira una tabla de números y opina
-- cuál le llama la atención es exactamente la falla que este proyecto viene
-- evitando desde la primera fase: no es reproducible, no es auditable, y un
-- día deja de avisar sin que nadie se entere. Acá cada señal tiene una regla
-- escrita, un umbral explícito y un impacto en dinero calculado.
--
-- El widget de IA recibe las señales ya detectadas. Su trabajo es priorizarlas
-- y decir qué hacer con cada una, no encontrarlas.

-- ---------------------------------------------------------------------------
-- Umbrales
-- ---------------------------------------------------------------------------
--
-- Se declaran en una función para que la pantalla y el contexto del modelo
-- puedan mostrarlos junto a cada hallazgo. Un aviso que no dice contra qué vara
-- se midió no se puede discutir.
create or replace function parametros_anomalias()
returns table (parametro text, valor numeric, descripcion text)
language sql
immutable
as $$
  values
    ('salto_precio_pct',      10.0,
     'Suba de precio de un insumo que amerita aviso.'),
    ('varianza_insumo_pct',    5.0,
     'Porcentaje del consumo teórico que puede quedar sin explicar sin llamar la atención.'),
    ('varianza_piso_dinero', 1000.0,
     'Piso en dinero: por debajo, un desvío porcentual grande sobre un insumo barato es ruido.'),
    ('retencion_margen_pct',  60.0,
     'Margen unitario mínimo que un canal debe dejar, respecto del mejor canal del mismo plato.'),
    ('cobertura_costeo_pct',  95.0,
     'Cobertura de costeo por debajo de la cual el food cost deja de describir al negocio.'),
    ('dias_sin_conteo',       30.0,
     'Días sin un conteo cerrado antes de que la varianza deje de ser confiable.')
$$;

create or replace function app_param_anomalia(p_nombre text)
returns numeric
language sql
immutable
as $$
  select valor from parametros_anomalias() where parametro = p_nombre
$$;

-- ---------------------------------------------------------------------------
-- Detección
-- ---------------------------------------------------------------------------

create or replace function deteccion_anomalias(p_desde date, p_hasta date)
returns table (
  tipo           text,
  severidad      text,
  entidad        text,
  detalle        text,
  valor          numeric,
  referencia     numeric,
  desvio_pct     numeric,
  umbral         numeric,
  impacto_dinero numeric
)
language sql
stable
as $$
  with
  -- Consumo teórico del período: es lo que convierte una suba de precio
  -- porcentual en un impacto en pesos sobre ESTE negocio. Un 40% sobre un
  -- insumo que casi no se usa no es una urgencia.
  consumo as (
    select insumo_id, cantidad from consumo_teorico_insumos(p_desde, p_hasta)
  ),
  -- Solo las altas de precio que TIENEN una anterior con la que compararse.
  -- El filtro va antes de calcular: app_precio_unitario() falla a propósito
  -- cuando no hay precio vigente a esa fecha, y el primer precio de un insumo
  -- no tiene día anterior.
  -- MATERIALIZED es obligatorio, no una optimización: sin la barrera el
  -- planificador sube la llamada a app_precio_unitario() por encima del EXISTS
  -- y la evalúa sobre filas que no tienen precio anterior, que es justo el caso
  -- en el que esa función aborta.
  con_previo as materialized (
    select p.insumo_id, i.nombre as insumo, p.vigente_desde
    from precios_insumo p
    join insumos i on i.id = p.insumo_id
    where exists (select 1 from precios_insumo q
                  where q.insumo_id = p.insumo_id
                    and q.vigente_desde < p.vigente_desde)
  ),
  cambios as (
    select c.insumo_id,
           c.insumo,
           c.vigente_desde,
           app_precio_unitario(c.insumo_id, c.vigente_desde)     as nuevo,
           app_precio_unitario(c.insumo_id, c.vigente_desde - 1) as previo
    from con_previo c
  ),
  saltos as (
    select c.*,
           100 * (c.nuevo - c.previo) / nullif(c.previo, 0) as salto_pct,
           coalesce(co.cantidad, 0)                          as consumo_periodo
    from cambios c
    left join consumo co on co.insumo_id = c.insumo_id
    where c.previo is not null
      and c.previo > 0
      and 100 * (c.nuevo - c.previo) / nullif(c.previo, 0)
            >= app_param_anomalia('salto_precio_pct')
  ),

  -- 1. Precio que subió DENTRO del período: ya encareció la materia prima.
  precio_periodo as (
    select 'precio_insumo'::text,
           case when s.salto_pct >= 25 then 'urgente' else 'atencion' end::text,
           s.insumo,
           format('El precio subió %s%% el %s y ya afecta el costo del período.',
                  round(s.salto_pct, 1), s.vigente_desde)::text,
           round(s.nuevo, 4),
           round(s.previo, 4),
           round(s.salto_pct, 2),
           app_param_anomalia('salto_precio_pct'),
           round((s.nuevo - s.previo) * s.consumo_periodo, 2)
    from saltos s
    where s.vigente_desde between p_desde and p_hasta
  ),

  -- 2. Precio ya cargado que rige DESPUÉS del período. Todavía no dolió, y
  --    por eso mismo es el único aviso que llega a tiempo para hacer algo:
  --    renegociar, cambiar de proveedor o ajustar la carta.
  precio_futuro as (
    select 'precio_futuro'::text,
           'atencion'::text,
           s.insumo,
           format('Sube %s%% a partir del %s. Al consumo de este período, son $%s más.',
                  round(s.salto_pct, 1), s.vigente_desde,
                  round((s.nuevo - s.previo) * s.consumo_periodo, 2))::text,
           round(s.nuevo, 4),
           round(s.previo, 4),
           round(s.salto_pct, 2),
           app_param_anomalia('salto_precio_pct'),
           round((s.nuevo - s.previo) * s.consumo_periodo, 2)
    from saltos s
    where s.vigente_desde > p_hasta
  ),

  -- 3. Faltante de inventario sin explicación, sobre los dos últimos conteos
  --    cerrados. Es el diferenciador del producto convertido en alerta.
  conteos_par as (
    select array_agg(id order by momento desc) as ids
    from (select id, momento from conteos where estado = 'cerrado'
          order by momento desc limit 2) x
  ),
  varianza as (
    select v.*
    from conteos_par cp
    cross join lateral varianza_periodo(cp.ids[2], cp.ids[1]) v
    where array_length(cp.ids, 1) = 2
  ),
  varianza_insumo as (
    select 'varianza_insumo'::text,
           case when v.no_explicada_dinero >= 10000 then 'urgente' else 'atencion' end::text,
           v.insumo,
           format('Faltan %s %s sin explicación entre los dos últimos conteos (%s%% del consumo teórico).',
                  round(v.varianza_no_explicada, 2), v.unidad,
                  round(100 * v.varianza_no_explicada / nullif(v.consumo_teorico, 0), 1))::text,
           round(v.varianza_no_explicada, 2),
           round(v.consumo_teorico, 2),
           round(100 * v.varianza_no_explicada / nullif(v.consumo_teorico, 0), 2),
           app_param_anomalia('varianza_insumo_pct'),
           round(v.no_explicada_dinero, 2)
    from varianza v
    where v.varianza_no_explicada > 0
      and 100 * v.varianza_no_explicada / nullif(v.consumo_teorico, 0)
            >= app_param_anomalia('varianza_insumo_pct')
      and v.no_explicada_dinero >= app_param_anomalia('varianza_piso_dinero')
  ),

  -- 4. Un plato que en un canal deja mucho menos que en su mejor canal.
  --    Que el delivery deje menos no es noticia: la comisión está a la vista.
  --    Lo que sí es noticia es el plato al que el canal le come más margen que
  --    al resto de la carta, porque ahí el problema es el precio de ESE plato
  --    en ESE canal, y se arregla sin tocar nada más.
  por_canal as (
    select producto_id, producto, canal,
           sum(cantidad)                        as unidades,
           sum(margen) / nullif(sum(cantidad), 0) as margen_unitario
    from vista_ventas_analitica
    where fecha between p_desde and p_hasta and costeada
    group by producto_id, producto, canal
    having sum(cantidad) > 0
  ),
  mejor as (
    select producto_id, max(margen_unitario) as mejor_margen
    from por_canal group by producto_id
  ),
  margen_canal as (
    select 'margen_canal'::text,
           case when c.margen_unitario <= 0 then 'urgente' else 'atencion' end::text,
           format('%s por %s', c.producto, c.canal)::text,
           format('Deja $%s por unidad contra $%s en su mejor canal: retiene el %s%%.',
                  round(c.margen_unitario, 2), round(m.mejor_margen, 2),
                  round(100 * c.margen_unitario / nullif(m.mejor_margen, 0), 1))::text,
           round(c.margen_unitario, 2),
           round(m.mejor_margen, 2),
           round(100 * c.margen_unitario / nullif(m.mejor_margen, 0), 2),
           app_param_anomalia('retencion_margen_pct'),
           -- Impacto: lo que se dejó de ganar en el período por vender ese
           -- plato en ese canal en lugar de en el mejor.
           round((m.mejor_margen - c.margen_unitario) * c.unidades, 2)
    from por_canal c
    join mejor m on m.producto_id = c.producto_id
    where m.mejor_margen > 0
      and (c.margen_unitario <= 0
           or 100 * c.margen_unitario / m.mejor_margen
                < app_param_anomalia('retencion_margen_pct'))
  ),

  -- 5. Ventas sin ficha técnica: no es un desvío, es una ceguera. El food cost
  --    del período describe solo la parte costeada.
  cobertura as (
    select coalesce(sum(neto) filter (where costeada), 0) as costeadas,
           coalesce(sum(neto), 0)                         as total,
           coalesce(sum(neto) filter (where not costeada), 0) as sin_costear
    from vista_ventas_analitica
    where fecha between p_desde and p_hasta
  ),
  cobertura_baja as (
    select 'cobertura_costeo'::text,
           'atencion'::text,
           'Ventas sin ficha técnica'::text,
           format('$%s de ventas (%s%%) no tienen receta cargada: su materia prima no entra en ningún costo.',
                  round(c.sin_costear, 2),
                  round(100 * c.sin_costear / nullif(c.total, 0), 1))::text,
           round(100 * c.costeadas / nullif(c.total, 0), 2),
           app_param_anomalia('cobertura_costeo_pct'),
           round(100 * c.costeadas / nullif(c.total, 0)
                 - app_param_anomalia('cobertura_costeo_pct'), 2),
           app_param_anomalia('cobertura_costeo_pct'),
           round(c.sin_costear, 2)
    from cobertura c
    where c.total > 0
      and 100 * c.costeadas / c.total < app_param_anomalia('cobertura_costeo_pct')
  ),

  -- 6. Turnos sin cerrar: abaratan el costo laboral sin que se note.
  abiertos as (
    select count(*) as n from vista_fichajes
    where fecha between p_desde and p_hasta and abierto
  ),
  fichajes_abiertos as (
    select 'fichaje_abierto'::text,
           'atencion'::text,
           'Turnos sin cerrar'::text,
           format('Hay %s fichaje(s) sin salida en el período. Esas horas no están costeadas, así que el costo laboral real es mayor.', a.n)::text,
           a.n::numeric,
           0::numeric,
           null::numeric,
           0::numeric,
           null::numeric
    from abiertos a where a.n > 0
  ),

  -- 7. Inventario viejo: la varianza es tan buena como el último conteo.
  ultimo_conteo as (
    select max(momento)::date as dia from conteos where estado = 'cerrado'
  ),
  conteo_viejo as (
    select 'conteo_desactualizado'::text,
           'informativo'::text,
           'Inventario sin contar'::text,
           format('El último conteo cerrado es del %s: %s días antes del cierre del período.',
                  u.dia, (p_hasta - u.dia))::text,
           (p_hasta - u.dia)::numeric,
           app_param_anomalia('dias_sin_conteo'),
           null::numeric,
           app_param_anomalia('dias_sin_conteo'),
           null::numeric
    from ultimo_conteo u
    where u.dia is not null
      and (p_hasta - u.dia) >= app_param_anomalia('dias_sin_conteo')
  )

  select *
  from (
              select * from precio_periodo
    union all select * from precio_futuro
    union all select * from varianza_insumo
    union all select * from margen_canal
    union all select * from cobertura_baja
    union all select * from fichajes_abiertos
    union all select * from conteo_viejo
  ) as s(tipo, severidad, entidad, detalle, valor, referencia, desvio_pct, umbral, impacto_dinero)
  -- Ordenado por plata, como el informe de varianza: un faltante de azafrán
  -- importa más que uno de papa, y ordenar por porcentaje lo escondería.
  order by s.impacto_dinero desc nulls last,
           case s.severidad when 'urgente' then 0 when 'atencion' then 1 else 2 end,
           s.entidad
$$;

comment on function deteccion_anomalias is
  'Señales detectadas por regla, con umbral explícito e impacto en dinero. El modelo las prioriza y recomienda; no las encuentra.';

-- ---------------------------------------------------------------------------
-- Emparejado de insumos por similitud
-- ---------------------------------------------------------------------------

-- Espejo de proponer_productos(), para el asistente de escandallos: el modelo
-- extrae los ingredientes de un texto libre, y el emparejado con el catálogo
-- lo hace el trigrama de Postgres, no el modelo. Un ingrediente mal emparejado
-- mete el costo equivocado en una ficha técnica y contamina todo lo que se
-- calcula después, sin que nada falle de forma visible.
create or replace function proponer_insumos(p_texto text, p_limite int default 5)
returns table (insumo_id uuid, nombre text, unidad_base text, similitud real)
language sql
stable
as $$
  select i.id, i.nombre, u.codigo,
         similarity(app_normalizar_texto(i.nombre), app_normalizar_texto(p_texto))
  from insumos i
  join unidades u on u.id = i.unidad_base_id
  where i.activo
    and similarity(app_normalizar_texto(i.nombre), app_normalizar_texto(p_texto)) > 0.2
  order by 4 desc, i.nombre
  limit p_limite
$$;
