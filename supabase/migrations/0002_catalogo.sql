-- 0002_catalogo.sql
-- Catálogo de insumos, proveedores y precios históricos.
--
-- Dos decisiones que condicionan todo el costeo:
--   1. Las unidades se convierten siempre a una unidad base por dimensión
--      (masa->g, volumen->ml, unidad->u). Un insumo comprado por kilo y usado
--      en gramos sin conversión produce costos con error de 1000x.
--   2. Los precios NUNCA se actualizan de forma destructiva: cada cambio es una
--      fila nueva con `vigente_desde`. Permite recostear una receta a cualquier
--      fecha pasada y medir la inflación real del menú.

-- ---------------------------------------------------------------------------
-- Unidades (datos de referencia, compartidos por todos los tenants)
-- ---------------------------------------------------------------------------

create type dimension_unidad as enum ('masa', 'volumen', 'unidad');

create table unidades (
  id            uuid primary key default gen_random_uuid(),
  codigo        text not null unique,           -- kg, g, l, ml, u
  nombre        text not null,
  dimension     dimension_unidad not null,
  factor_a_base numeric(20,10) not null check (factor_a_base > 0)
);

comment on column unidades.factor_a_base is
  'Cuántas unidades base equivale 1 de esta unidad. Base: masa=g, volumen=ml, unidad=u.';

insert into unidades (codigo, nombre, dimension, factor_a_base) values
  ('g',  'gramo',      'masa',    1),
  ('kg', 'kilogramo',  'masa',    1000),
  ('ml', 'mililitro',  'volumen', 1),
  ('l',  'litro',      'volumen', 1000),
  ('u',  'unidad',     'unidad',  1);

alter table unidades enable row level security;
create policy unidades_lectura on unidades for select using (true);

-- ---------------------------------------------------------------------------
-- Conversión de unidades
-- ---------------------------------------------------------------------------

-- Convierte entre unidades. Entre dimensiones distintas (litros de aceite ->
-- gramos) requiere densidad en g/ml; sin ella falla de forma explícita en vez
-- de devolver un número silenciosamente incorrecto.
create or replace function app_convertir(
  cantidad  numeric,
  desde     uuid,
  hacia     uuid,
  densidad  numeric default null   -- g/ml
) returns numeric
language plpgsql
immutable
as $$
declare
  u_desde unidades%rowtype;
  u_hacia unidades%rowtype;
  en_base numeric;
begin
  if cantidad is null then return null; end if;

  select * into u_desde from unidades where id = desde;
  if not found then
    raise exception 'unidad de origen % inexistente', desde;
  end if;
  select * into u_hacia from unidades where id = hacia;
  if not found then
    raise exception 'unidad de destino % inexistente', hacia;
  end if;

  en_base := cantidad * u_desde.factor_a_base;

  if u_desde.dimension = u_hacia.dimension then
    return en_base / u_hacia.factor_a_base;
  end if;

  if densidad is null or densidad <= 0 then
    raise exception
      'no se puede convertir de % a %: se requiere densidad (g/ml) del insumo',
      u_desde.codigo, u_hacia.codigo;
  end if;

  if u_desde.dimension = 'volumen' and u_hacia.dimension = 'masa' then
    return (en_base * densidad) / u_hacia.factor_a_base;     -- ml -> g
  elsif u_desde.dimension = 'masa' and u_hacia.dimension = 'volumen' then
    return (en_base / densidad) / u_hacia.factor_a_base;     -- g -> ml
  end if;

  raise exception 'conversión no soportada de % a %', u_desde.codigo, u_hacia.codigo;
end
$$;

-- ---------------------------------------------------------------------------
-- Proveedores
-- ---------------------------------------------------------------------------

create table proveedores (
  id              uuid primary key default gen_random_uuid(),
  organizacion_id uuid not null references organizaciones(id) on delete cascade,
  nombre          text not null check (length(trim(nombre)) > 0),
  contacto        text,
  activo          boolean not null default true,
  creado_en       timestamptz not null default now(),
  unique (organizacion_id, nombre)
);
create index on proveedores (organizacion_id);

-- ---------------------------------------------------------------------------
-- Insumos
-- ---------------------------------------------------------------------------

create table insumos (
  id                 uuid primary key default gen_random_uuid(),
  organizacion_id    uuid not null references organizaciones(id) on delete cascade,
  nombre             text not null check (length(trim(nombre)) > 0),
  categoria          text,
  unidad_base_id     uuid not null references unidades(id),
  merma_limpieza_pct numeric(5,2) not null default 0
                       check (merma_limpieza_pct >= 0 and merma_limpieza_pct < 100),
  densidad_g_ml      numeric(10,4) check (densidad_g_ml is null or densidad_g_ml > 0),
  activo             boolean not null default true,
  creado_en          timestamptz not null default now(),
  unique (organizacion_id, nombre)
);
create index on insumos (organizacion_id);

comment on column insumos.merma_limpieza_pct is
  'Porcentaje que se pierde al limpiar o porcionar. Un kilo de papa con 20% de merma rinde 800 g útiles: para usar 800 g netos hay que comprar 1 kg. Las recetas expresan cantidades NETAS.';

comment on column insumos.densidad_g_ml is
  'Requerida solo si el insumo se compra en una dimensión y se usa en otra (ej. aceite comprado por litro y usado por gramo).';

-- ---------------------------------------------------------------------------
-- Precios históricos
-- ---------------------------------------------------------------------------

create table precios_insumo (
  id                    uuid primary key default gen_random_uuid(),
  organizacion_id       uuid not null references organizaciones(id) on delete cascade,
  insumo_id             uuid not null references insumos(id) on delete cascade,
  proveedor_id          uuid references proveedores(id) on delete set null,
  precio                numeric(14,4) not null check (precio >= 0),
  cantidad_presentacion numeric(14,4) not null check (cantidad_presentacion > 0),
  unidad_id             uuid not null references unidades(id),
  vigente_desde         date not null default current_date,
  creado_en             timestamptz not null default now()
);
create index on precios_insumo (organizacion_id);
create index on precios_insumo (insumo_id, vigente_desde desc);

comment on table precios_insumo is
  'Histórico append-only. "Caja de 5 kg a $12.000" = precio 12000, cantidad_presentacion 5, unidad kg.';

-- Precio por unidad base del insumo, vigente a una fecha.
-- Toma el precio más reciente con vigente_desde <= fecha.
create or replace function app_precio_unitario(
  p_insumo_id uuid,
  p_fecha     date default current_date
) returns numeric
language plpgsql
stable
as $$
declare
  ins       insumos%rowtype;
  pr        precios_insumo%rowtype;
  cant_base numeric;
begin
  select * into ins from insumos where id = p_insumo_id;
  if not found then
    raise exception 'insumo % inexistente', p_insumo_id;
  end if;

  select * into pr
  from precios_insumo
  where insumo_id = p_insumo_id and vigente_desde <= p_fecha
  order by vigente_desde desc, creado_en desc
  limit 1;

  if not found then
    raise exception 'el insumo "%" no tiene precio vigente al %', ins.nombre, p_fecha;
  end if;

  cant_base := app_convertir(pr.cantidad_presentacion, pr.unidad_id,
                             ins.unidad_base_id, ins.densidad_g_ml);
  return pr.precio / cant_base;
end
$$;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table proveedores    enable row level security;
alter table insumos        enable row level security;
alter table precios_insumo enable row level security;
alter table proveedores    force row level security;
alter table insumos        force row level security;
alter table precios_insumo force row level security;

create policy proveedores_lectura on proveedores
  for select using (app_es_miembro(organizacion_id));
create policy proveedores_escritura on proveedores
  for all
  using (app_tiene_rol(organizacion_id, array['propietario','gerente','compras']::rol_miembro[]))
  with check (app_tiene_rol(organizacion_id, array['propietario','gerente','compras']::rol_miembro[]));

create policy insumos_lectura on insumos
  for select using (app_es_miembro(organizacion_id));
create policy insumos_escritura on insumos
  for all
  using (app_tiene_rol(organizacion_id, array['propietario','gerente','compras']::rol_miembro[]))
  with check (app_tiene_rol(organizacion_id, array['propietario','gerente','compras']::rol_miembro[]));

create policy precios_lectura on precios_insumo
  for select using (app_es_miembro(organizacion_id));
create policy precios_escritura on precios_insumo
  for all
  using (app_tiene_rol(organizacion_id, array['propietario','gerente','compras']::rol_miembro[]))
  with check (app_tiene_rol(organizacion_id, array['propietario','gerente','compras']::rol_miembro[]));
