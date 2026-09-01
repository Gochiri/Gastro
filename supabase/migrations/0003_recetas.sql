-- 0003_recetas.sql
-- Escandallos (fichas técnicas) con subrecetas anidadas y costeo recursivo.
--
-- Una receta puede contener insumos y OTRAS RECETAS: una salsa base entra en
-- ocho platos distintos, y al cambiar el precio del tomate los ocho deben
-- recostearse solos. Esa recursión es la razón por la que el costeo vive en
-- Postgres y no en el código de aplicación.
--
-- Las cantidades de receta son NETAS (producto ya limpio). La merma de limpieza
-- del insumo se aplica al costear: 800 g netos de papa con 20% de merma cuestan
-- lo que cuesta 1 kg comprado.

create type tipo_receta     as enum ('plato', 'subreceta');
create type tipo_componente as enum ('insumo', 'receta');

create table recetas (
  id                    uuid primary key default gen_random_uuid(),
  organizacion_id       uuid not null references organizaciones(id) on delete cascade,
  nombre                text not null check (length(trim(nombre)) > 0),
  tipo                  tipo_receta not null default 'plato',
  rendimiento_cantidad  numeric(14,4) not null check (rendimiento_cantidad > 0),
  rendimiento_unidad_id uuid not null references unidades(id),
  notas                 text,
  activa                boolean not null default true,
  creada_en             timestamptz not null default now(),
  unique (organizacion_id, nombre)
);
create index on recetas (organizacion_id);

comment on column recetas.rendimiento_cantidad is
  'Cuánto produce una elaboración completa: 10 porciones, 2.5 l de salsa, 1 unidad de plato.';

create table receta_items (
  id              uuid primary key default gen_random_uuid(),
  organizacion_id uuid not null references organizaciones(id) on delete cascade,
  receta_id       uuid not null references recetas(id) on delete cascade,
  componente_tipo tipo_componente not null,
  insumo_id       uuid references insumos(id) on delete restrict,
  subreceta_id    uuid references recetas(id) on delete restrict,
  cantidad        numeric(14,4) not null check (cantidad > 0),
  unidad_id       uuid not null references unidades(id),
  orden           smallint not null default 0,

  -- Exactamente un componente según el tipo declarado.
  constraint componente_coherente check (
    (componente_tipo = 'insumo' and insumo_id is not null and subreceta_id is null)
    or
    (componente_tipo = 'receta' and subreceta_id is not null and insumo_id is null)
  ),
  -- Autorreferencia directa. Los ciclos indirectos los detecta costo_receta().
  constraint sin_autorreferencia check (subreceta_id is null or subreceta_id <> receta_id)
);
create index on receta_items (organizacion_id);
create index on receta_items (receta_id);
create index on receta_items (subreceta_id) where subreceta_id is not null;

-- ---------------------------------------------------------------------------
-- Costeo recursivo
-- ---------------------------------------------------------------------------

-- Explosión del árbol de la receta: devuelve cada insumo hoja con el factor
-- acumulado por el que hay que multiplicar su cantidad. Un ciclo (receta que se
-- contiene a sí misma a través de subrecetas) se detecta y aborta con error
-- explícito en vez de colgar la consulta.
create or replace function app_explotar_receta(
  p_receta_id uuid
) returns table (
  receta_id uuid,
  item_id   uuid,
  insumo_id uuid,
  cantidad  numeric,
  unidad_id uuid,
  factor    numeric,
  nivel     int
)
language plpgsql
stable
as $$
declare
  v_ciclo text;
begin
  -- Paso 1: detectar ciclos antes de costear nada.
  with recursive arbol as (
    select r.id as rid, array[r.id] as ruta, false as ciclo, 0 as nivel
    from recetas r
    where r.id = p_receta_id
    union all
    select ri.subreceta_id,
           a.ruta || ri.subreceta_id,
           ri.subreceta_id = any(a.ruta),
           a.nivel + 1
    from arbol a
    join receta_items ri
      on ri.receta_id = a.rid and ri.componente_tipo = 'receta'
    where not a.ciclo and a.nivel < 20
  )
  select string_agg(distinct r.nombre, ' -> ')
    into v_ciclo
  from arbol a
  join recetas r on r.id = a.rid
  where a.ciclo;

  if v_ciclo is not null then
    raise exception 'ciclo de subrecetas detectado en la receta %: %',
      p_receta_id, v_ciclo
      using hint = 'Una receta no puede contenerse a sí misma, ni directa ni indirectamente.';
  end if;

  -- Paso 2: expandir acumulando el factor de escala de cada subreceta.
  -- Si un item pide 500 ml de una salsa que rinde 2000 ml, el factor de esa
  -- rama es 0.25: se consume un cuarto de los ingredientes de la salsa.
  return query
  with recursive arbol as (
    select r.id as rid, 1::numeric as factor, 0 as nivel
    from recetas r
    where r.id = p_receta_id
    union all
    select sub.id,
           a.factor * (
             app_convertir(ri.cantidad, ri.unidad_id, sub.rendimiento_unidad_id, null)
             / sub.rendimiento_cantidad
           ),
           a.nivel + 1
    from arbol a
    join receta_items ri
      on ri.receta_id = a.rid and ri.componente_tipo = 'receta'
    join recetas sub on sub.id = ri.subreceta_id
    where a.nivel < 20
  )
  select a.rid, ri.id, ri.insumo_id, ri.cantidad, ri.unidad_id, a.factor, a.nivel
  from arbol a
  join receta_items ri
    on ri.receta_id = a.rid and ri.componente_tipo = 'insumo';
end
$$;

-- Costo de una elaboración completa (el rendimiento entero) a una fecha dada.
create or replace function costo_receta(
  p_receta_id uuid,
  p_fecha     date default current_date
) returns numeric
language plpgsql
stable
as $$
declare
  v_costo numeric;
begin
  if not exists (select 1 from recetas where id = p_receta_id) then
    raise exception 'receta % inexistente o sin acceso', p_receta_id;
  end if;

  select coalesce(sum(
           -- cantidad neta -> bruta según merma de limpieza del insumo
           (app_convertir(e.cantidad, e.unidad_id, i.unidad_base_id, i.densidad_g_ml)
             / (1 - i.merma_limpieza_pct / 100))
           * app_precio_unitario(i.id, p_fecha)
           * e.factor
         ), 0)
    into v_costo
  from app_explotar_receta(p_receta_id) e
  join insumos i on i.id = e.insumo_id;

  return round(v_costo, 4);
end
$$;

-- Costo unitario: por porción, por litro o por unidad, según el rendimiento.
create or replace function costo_porcion(
  p_receta_id uuid,
  p_fecha     date default current_date
) returns numeric
language sql
stable
as $$
  select round(costo_receta(p_receta_id, p_fecha) / r.rendimiento_cantidad, 4)
  from recetas r
  where r.id = p_receta_id
$$;

-- Desglose por insumo, para la pantalla de ficha técnica: muestra de dónde sale
-- cada peso del costo y qué porcentaje representa.
create or replace function costo_receta_detalle(
  p_receta_id uuid,
  p_fecha     date default current_date
) returns table (
  insumo            text,
  cantidad_bruta    numeric,
  unidad            text,
  precio_unitario   numeric,
  costo             numeric,
  pct_del_total     numeric
)
language sql
stable
as $$
  with lineas as (
    select i.nombre as insumo,
           u.codigo as unidad,
           (app_convertir(e.cantidad, e.unidad_id, i.unidad_base_id, i.densidad_g_ml)
             / (1 - i.merma_limpieza_pct / 100)) * e.factor as cantidad_bruta,
           app_precio_unitario(i.id, p_fecha) as precio_unitario
    from app_explotar_receta(p_receta_id) e
    join insumos i on i.id = e.insumo_id
    join unidades u on u.id = i.unidad_base_id
  ),
  agrupado as (
    -- Un mismo insumo puede aparecer en varias subrecetas: se consolida.
    select insumo, unidad, precio_unitario,
           sum(cantidad_bruta) as cantidad_bruta,
           sum(cantidad_bruta * precio_unitario) as costo
    from lineas
    group by insumo, unidad, precio_unitario
  )
  select insumo,
         round(cantidad_bruta, 4),
         unidad,
         round(precio_unitario, 4),
         round(costo, 4),
         round(100 * costo / nullif(sum(costo) over (), 0), 2)
  from agrupado
  order by costo desc
$$;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table recetas      enable row level security;
alter table receta_items enable row level security;
alter table recetas      force row level security;
alter table receta_items force row level security;

create policy recetas_lectura on recetas
  for select using (app_es_miembro(organizacion_id));
create policy recetas_escritura on recetas
  for all
  using (app_tiene_rol(organizacion_id, array['propietario','gerente']::rol_miembro[]))
  with check (app_tiene_rol(organizacion_id, array['propietario','gerente']::rol_miembro[]));

create policy receta_items_lectura on receta_items
  for select using (app_es_miembro(organizacion_id));
create policy receta_items_escritura on receta_items
  for all
  using (app_tiene_rol(organizacion_id, array['propietario','gerente']::rol_miembro[]))
  with check (app_tiene_rol(organizacion_id, array['propietario','gerente']::rol_miembro[]));
