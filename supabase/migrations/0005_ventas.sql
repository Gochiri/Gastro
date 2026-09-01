-- 0005_ventas.sql
-- Ventas importadas por CSV, con su costo teórico congelado.
--
-- Decisión central: `ventas` guarda el costo unitario y el porcentaje de
-- comisión VIGENTES AL IMPORTAR, no referencias que se recalculen al consultar.
-- Un mes ya reportado no debe cambiar de números porque alguien corrigió un
-- precio hoy. Para las correcciones legítimas está recalcular_costos_ventas().

create extension if not exists pg_trgm;

-- ---------------------------------------------------------------------------
-- Normalización de texto
-- ---------------------------------------------------------------------------

-- Minúsculas, sin acentos, sin puntuación, espacios colapsados.
--
-- Con translate() y no con unaccent(): unaccent no es IMMUTABLE (depende de un
-- diccionario) así que no puede indexarse ni usarse en una columna generada, y
-- en Supabase vive en el esquema `extensions`, lo que rompe el search_path.
create or replace function app_normalizar_texto(p_texto text)
returns text
language sql
immutable
as $$
  select nullif(
    regexp_replace(
      regexp_replace(
        lower(translate(coalesce(p_texto, ''),
                        'áàäâãéèëêíìïîóòöôõúùüûñçÁÀÄÂÃÉÈËÊÍÌÏÎÓÒÖÔÕÚÙÜÛÑÇ',
                        'aaaaaeeeeiiiiooooouuuuncAAAAAEEEEIIIIOOOOOUUUUNC')),
        '[^a-z0-9 ]', ' ', 'g'),          -- puntuación fuera
      '\s+', ' ', 'g'),                    -- espacios colapsados
    '')
$$;

-- ---------------------------------------------------------------------------
-- Canales de venta
-- ---------------------------------------------------------------------------

create table canales (
  id              uuid primary key default gen_random_uuid(),
  organizacion_id uuid not null references organizaciones(id) on delete cascade,
  nombre          text not null check (length(trim(nombre)) > 0),
  comision_pct    numeric(5,2) not null default 0
                    check (comision_pct >= 0 and comision_pct < 100),
  activo          boolean not null default true,
  creado_en       timestamptz not null default now(),
  unique (organizacion_id, nombre)
);
create index on canales (organizacion_id);

comment on column canales.comision_pct is
  'Comisión que retiene el canal. Un agregador de delivery que se lleva 28% puede volver deficitario un plato rentable en salón.';

-- ---------------------------------------------------------------------------
-- Productos vendibles
-- ---------------------------------------------------------------------------

create table productos (
  id              uuid primary key default gen_random_uuid(),
  organizacion_id uuid not null references organizaciones(id) on delete cascade,
  nombre          text not null check (length(trim(nombre)) > 0),
  receta_id       uuid references recetas(id) on delete set null,
  categoria       text,
  activo          boolean not null default true,
  creado_en       timestamptz not null default now(),
  unique (organizacion_id, nombre)
);
create index on productos (organizacion_id);
create index on productos (receta_id) where receta_id is not null;

comment on column productos.receta_id is
  'Nullable a propósito: se puede importar ventas antes de tener la ficha técnica. Esos productos no aportan costo y bajan la cobertura de costeo, que el dashboard muestra junto al food cost.';

-- ---------------------------------------------------------------------------
-- Memoria del importador
-- ---------------------------------------------------------------------------

create table alias_producto (
  id                 uuid primary key default gen_random_uuid(),
  organizacion_id    uuid not null references organizaciones(id) on delete cascade,
  texto_normalizado  text not null,
  producto_id        uuid not null references productos(id) on delete cascade,
  creado_en          timestamptz not null default now(),
  unique (organizacion_id, texto_normalizado)
);
create index on alias_producto (organizacion_id);

comment on table alias_producto is
  'Cada corrección manual del importador se guarda aquí. La próxima importación resuelve sola esa variante de escritura.';

-- El nombre del producto es su propio alias: evita pedir confirmación para
-- textos que ya coinciden exactamente con el catálogo.
create or replace function app_sincronizar_alias_producto()
returns trigger
language plpgsql
as $$
begin
  insert into alias_producto (organizacion_id, texto_normalizado, producto_id)
  values (new.organizacion_id, app_normalizar_texto(new.nombre), new.id)
  on conflict (organizacion_id, texto_normalizado) do nothing;
  return new;
end
$$;

create trigger productos_alias_propio
  after insert or update of nombre on productos
  for each row execute function app_sincronizar_alias_producto();

-- ---------------------------------------------------------------------------
-- Importaciones
-- ---------------------------------------------------------------------------

create type estado_importacion as enum ('borrador', 'confirmada', 'descartada');

create table importaciones (
  id              uuid primary key default gen_random_uuid(),
  organizacion_id uuid not null references organizaciones(id) on delete cascade,
  sucursal_id     uuid references sucursales(id) on delete set null,
  nombre_archivo  text not null,
  hash_archivo    text not null,
  mapeo           jsonb not null default '{}'::jsonb,
  estado          estado_importacion not null default 'borrador',
  filas_total     integer not null default 0,
  filas_ok        integer not null default 0,
  filas_error     integer not null default 0,
  creada_por      uuid,
  creada_en       timestamptz not null default now(),
  confirmada_en   timestamptz
);
create index on importaciones (organizacion_id);

-- Subir dos veces el mismo archivo duplicaría las ventas del período. Se
-- rechaza por hash del contenido. No se deduplica fila por fila: un restaurante
-- vende legítimamente el mismo plato dos veces el mismo día y canal.
create unique index importaciones_archivo_unico
  on importaciones (organizacion_id, hash_archivo)
  where estado <> 'descartada';

create type estado_fila as enum ('ok', 'sin_producto', 'error');

create table ventas_staging (
  id              uuid primary key default gen_random_uuid(),
  organizacion_id uuid not null references organizaciones(id) on delete cascade,
  importacion_id  uuid not null references importaciones(id) on delete cascade,
  numero_fila     integer not null,
  crudo           jsonb not null,
  fecha           date,
  texto_producto  text,
  texto_canal     text,
  cantidad        numeric(14,4),
  importe_bruto   numeric(14,4),
  descuento       numeric(14,4) not null default 0,
  producto_id     uuid references productos(id) on delete set null,
  canal_id        uuid references canales(id) on delete set null,
  estado          estado_fila not null default 'error',
  error           text,
  unique (importacion_id, numero_fila)
);
create index on ventas_staging (organizacion_id);
create index on ventas_staging (importacion_id, estado);

-- ---------------------------------------------------------------------------
-- Ventas confirmadas
-- ---------------------------------------------------------------------------

create table ventas (
  id                     uuid primary key default gen_random_uuid(),
  organizacion_id        uuid not null references organizaciones(id) on delete cascade,
  sucursal_id            uuid references sucursales(id) on delete set null,
  importacion_id         uuid references importaciones(id) on delete set null,
  fecha                  date not null,
  canal_id               uuid not null references canales(id) on delete restrict,
  producto_id            uuid not null references productos(id) on delete restrict,
  cantidad               numeric(14,4) not null check (cantidad > 0),
  importe_bruto          numeric(14,4) not null check (importe_bruto >= 0),
  descuento              numeric(14,4) not null default 0 check (descuento >= 0),

  -- Valores CONGELADOS al importar. Ver comentarios abajo.
  costo_unitario_teorico numeric(14,4),
  comision_pct_aplicada  numeric(5,2) not null default 0,
  costeada_en            timestamptz,

  creada_en              timestamptz not null default now()
);
create index on ventas (organizacion_id);
create index on ventas (organizacion_id, fecha);
create index on ventas (producto_id);
create index on ventas (canal_id);

comment on column ventas.costo_unitario_teorico is
  'Costo por unidad vendida al momento de importar. NULL si el producto no tenía receta: esas ventas bajan la cobertura de costeo en lugar de fingir un costo cero.';

comment on column ventas.comision_pct_aplicada is
  'Comisión del canal vigente al importar. Se congela junto al costo: renegociar con un agregador no debe reescribir el margen de los meses ya cerrados.';

comment on column ventas.costeada_en is
  'Cuándo se calculó el costo. La interfaz lo muestra para que nadie confunda un costeo viejo con uno fresco.';

-- ---------------------------------------------------------------------------
-- Resolución de productos
-- ---------------------------------------------------------------------------

-- Alias exacto sobre el texto normalizado. Devuelve null si no hay certeza.
create or replace function resolver_producto(p_texto text)
returns uuid
language sql
stable
as $$
  select a.producto_id
  from alias_producto a
  where a.texto_normalizado = app_normalizar_texto(p_texto)
  limit 1
$$;

-- Candidatos por similitud, para que una PERSONA elija. No se autoasigna nada:
-- un emparejado equivocado mete ventas en el plato erróneo y corrompe el food
-- cost sin que nada falle de forma visible.
create or replace function proponer_productos(p_texto text, p_limite int default 5)
returns table (producto_id uuid, nombre text, similitud real)
language sql
stable
as $$
  select p.id, p.nombre,
         similarity(app_normalizar_texto(p.nombre), app_normalizar_texto(p_texto))
  from productos p
  where p.activo
    and similarity(app_normalizar_texto(p.nombre), app_normalizar_texto(p_texto)) > 0.2
  order by 3 desc, p.nombre
  limit p_limite
$$;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

do $$
declare t record; pol text;
begin
  for t in
    select * from (values
      ('canales',        $r$array['propietario','gerente']$r$),
      ('productos',      $r$array['propietario','gerente']$r$),
      ('alias_producto', $r$array['propietario','gerente']$r$),
      ('importaciones',  $r$array['propietario','gerente']$r$),
      ('ventas_staging', $r$array['propietario','gerente']$r$),
      ('ventas',         $r$array['propietario','gerente']$r$)
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
