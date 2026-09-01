-- 0009_varianza.sql
-- La varianza de food cost: la diferencia entre lo que las recetas dicen que
-- debió consumirse y lo que el inventario dice que se consumió.
--
-- Es el diferenciador del producto. Un restaurante con 20% de food cost teórico
-- y 28% real pierde ocho puntos de margen en desperdicio, robo o porciones mal
-- servidas, y hoy no tiene forma de verlo.

-- ---------------------------------------------------------------------------
-- Consumo teórico por insumo
-- ---------------------------------------------------------------------------

-- Cuánto de cada insumo DEBIÓ salir de la heladera, según lo vendido.
--
-- Reutiliza app_explotar_receta(), que ya resuelve el árbol de subrecetas: el
-- tomate de una lasaña llega por Ragú -> Salsa Pomodoro, y aparece igual.
--
-- En cantidades BRUTAS: de la cámara sale el kilo entero de papa, no los 800 g
-- que quedan después de pelarla.
create or replace function consumo_teorico_insumos(
  p_desde date,
  p_hasta date
) returns table (
  insumo_id     uuid,
  insumo        text,
  unidad        text,
  cantidad      numeric,
  costo         numeric
)
language sql
stable
as $$
  with ventas_periodo as (
    select v.producto_id, p.receta_id, sum(v.cantidad) as unidades
    from ventas v
    join productos p on p.id = v.producto_id
    where v.fecha between p_desde and p_hasta
      and p.receta_id is not null
    group by v.producto_id, p.receta_id
  ),
  explosion as (
    select vp.unidades,
           e.insumo_id,
           -- cantidad del item -> unidad base del insumo -> por unidad vendida
           -- (dividido por el rendimiento) -> a bruto (dividido por 1 - merma)
           (app_convertir(e.cantidad, e.unidad_id, i.unidad_base_id, i.densidad_g_ml)
             * e.factor
             / r.rendimiento_cantidad
             / (1 - i.merma_limpieza_pct / 100)
           ) * vp.unidades as bruto
    from ventas_periodo vp
    join recetas r on r.id = vp.receta_id
    cross join lateral app_explotar_receta(vp.receta_id) e
    join insumos i on i.id = e.insumo_id
  )
  select i.id,
         i.nombre,
         u.codigo,
         round(sum(x.bruto), 4),
         round(sum(x.bruto) * app_precio_unitario(i.id, p_hasta), 4)
  from explosion x
  join insumos i  on i.id = x.insumo_id
  join unidades u on u.id = i.unidad_base_id
  group by i.id, i.nombre, u.codigo
  order by 5 desc
$$;

comment on function consumo_teorico_insumos is
  'Consumo que las recetas predicen para las ventas del período, en la unidad base de cada insumo y en cantidades brutas (incluyendo la merma de limpieza).';

-- ---------------------------------------------------------------------------
-- Varianza entre dos conteos
-- ---------------------------------------------------------------------------

-- Compara el consumo real contra el teórico para cada insumo contado en AMBOS
-- conteos, y separa la parte explicada por mermas registradas de la que no
-- tiene explicación.
--
-- Un insumo contado en un solo conteo queda FUERA del informe. Asumir cero en
-- el que falta inventaría un faltante que no existe.
--
-- Teórico y real se valúan al MISMO precio unitario. Es una decisión analítica:
-- valuando cada lado a su propio precio, la varianza mezclaría "usar de más"
-- con "pagar de más", que son problemas distintos con responsables distintos.
-- Esta función mide varianza de USO.
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
  compras_periodo as (
    select c.insumo_id,
           sum(app_convertir(c.cantidad, c.unidad_id, i.unidad_base_id, i.densidad_g_ml)) as cantidad
    from compras c
    join insumos i on i.id = c.insumo_id
    cross join periodo p
    where c.fecha > p.desde and c.fecha <= p.hasta
    group by c.insumo_id
  ),
  mermas_periodo as (
    select m.insumo_id,
           sum(app_convertir(m.cantidad, m.unidad_id, i.unidad_base_id, i.densidad_g_ml)) as cantidad
    from mermas m
    join insumos i on i.id = m.insumo_id
    cross join periodo p
    where m.fecha > p.desde and m.fecha <= p.hasta
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
           b.inicial + coalesce(cp.cantidad, 0) - b.final as real,
           coalesce(t.cantidad, 0)                        as teorico,
           coalesce(mp.cantidad, 0)                       as mermas,
           app_precio_unitario(b.insumo_id, (select hasta from periodo)) as precio
    from base b
    left join compras_periodo cp on cp.insumo_id = b.insumo_id
    left join mermas_periodo  mp on mp.insumo_id = b.insumo_id
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

-- ---------------------------------------------------------------------------
-- Resumen del período
-- ---------------------------------------------------------------------------

-- Los totales para el dashboard, incluida la cobertura: con conteos parciales,
-- decir "food cost real 28%" sin aclarar que cubre el 60% del costo es mentir
-- por omisión.
create or replace function resumen_varianza(
  p_conteo_inicial uuid,
  p_conteo_final   uuid
) returns table (
  costo_teorico_cubierto numeric,
  costo_real_cubierto    numeric,
  varianza_dinero        numeric,
  mermas_dinero          numeric,
  no_explicada_dinero    numeric,
  costo_teorico_total    numeric,
  cobertura_pct          numeric,
  insumos_comparados     bigint,
  ventas_costeadas       numeric,
  food_cost_teorico_pct  numeric,
  food_cost_real_pct     numeric
)
language plpgsql
stable
as $$
declare
  c_ini conteos%rowtype;
  c_fin conteos%rowtype;
  v_desde date;
  v_hasta date;
begin
  select * into c_ini from conteos where id = p_conteo_inicial;
  select * into c_fin from conteos where id = p_conteo_final;
  if c_ini.id is null or c_fin.id is null then
    raise exception 'conteos inexistentes o sin acceso';
  end if;
  v_desde := c_ini.momento::date;
  v_hasta := c_fin.momento::date;

  return query
  with v as (
    select * from varianza_periodo(p_conteo_inicial, p_conteo_final)
  ),
  total_teorico as (
    select coalesce(sum(costo), 0) as costo from consumo_teorico_insumos(v_desde, v_hasta)
  ),
  -- Denominador: ventas COSTEADAS, el mismo criterio que usa resumen_ventas()
  -- en 0007_kpis.sql. Dos pantallas que muestran "food cost" con denominadores
  -- distintos dan números distintos para lo mismo, y el usuario deja de creer
  -- en los dos.
  ventas as (
    select coalesce(sum(ve.importe_bruto - ve.descuento), 0) as neto
    from ventas ve
    where ve.fecha between v_desde and v_hasta
      and ve.costo_unitario_teorico is not null
  ),
  -- Las columnas se califican con el alias: los parámetros de salida de esta
  -- función se llaman igual que las columnas de varianza_periodo(), y sin
  -- calificar Postgres no sabe a cuál se refiere.
  agregado as (
    select coalesce(sum(v.consumo_teorico * v.precio_unitario), 0)   as teorico_cubierto,
           coalesce(sum(v.consumo_real    * v.precio_unitario), 0)   as real_cubierto,
           coalesce(sum(v.varianza_dinero), 0)                       as varianza,
           coalesce(sum(v.mermas_registradas * v.precio_unitario), 0) as mermas,
           coalesce(sum(v.no_explicada_dinero), 0)                   as no_explicada,
           count(*)                                                  as insumos
    from v
  )
  select round(a.teorico_cubierto, 2),
         round(a.real_cubierto, 2),
         round(a.varianza, 2),
         round(a.mermas, 2),
         round(a.no_explicada, 2),
         round(t.costo, 2),
         round(100 * a.teorico_cubierto / nullif(t.costo, 0), 2),
         a.insumos,
         round(ve.neto, 2),
         round(100 * t.costo / nullif(ve.neto, 0), 2),
         -- El food cost real se extrapola: el consumo real medido sobre los
         -- insumos contados, más el teórico de los no contados. Solo es
         -- confiable en la medida en que la cobertura sea alta, y por eso las
         -- dos cifras viajan juntas.
         round(100 * (a.real_cubierto + (t.costo - a.teorico_cubierto)) / nullif(ve.neto, 0), 2)
  from agregado a, total_teorico t, ventas ve;
end
$$;
