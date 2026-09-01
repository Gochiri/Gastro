-- 0001_tenancy.sql
-- Fundación multi-tenant. Toda tabla transaccional del sistema lleva
-- organizacion_id y una política RLS que la filtra. El aislamiento vive en la
-- base de datos: una consulta sin WHERE no puede filtrar datos de otro cliente.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Organizaciones (tenants)
-- ---------------------------------------------------------------------------

create table organizaciones (
  id             uuid primary key default gen_random_uuid(),
  nombre         text        not null check (length(trim(nombre)) > 0),
  pais           char(2)     not null,              -- ISO 3166-1 alfa-2: AR, MX, CO...
  moneda         char(3)     not null,              -- ISO 4217: ARS, MXN, COP...
  config_fiscal  jsonb       not null default '{}'::jsonb,
  creada_en      timestamptz not null default now()
);

comment on column organizaciones.config_fiscal is
  'Alícuotas de IVA y retenciones por país. Solo cálculo y reportes: el sistema no emite comprobantes fiscales.';

create table sucursales (
  id              uuid primary key default gen_random_uuid(),
  organizacion_id uuid not null references organizaciones(id) on delete cascade,
  nombre          text not null check (length(trim(nombre)) > 0),
  direccion       text,
  activa          boolean not null default true,
  creada_en       timestamptz not null default now(),
  unique (organizacion_id, nombre)
);

create index on sucursales (organizacion_id);

-- ---------------------------------------------------------------------------
-- Membresías y roles
-- ---------------------------------------------------------------------------

create type rol_miembro as enum (
  'propietario',   -- todo, incluida la gestión de miembros
  'gerente',       -- todo lo operativo y financiero
  'compras',       -- insumos, proveedores, órdenes de compra, recepciones
  'contador',      -- lectura de finanzas y reportes fiscales
  'solo_lectura'
);

-- usuario_id referencia auth.users(id) de Supabase. Sin FK declarada para que
-- las migraciones corran también en un Postgres limpio (tests locales, CI).
create table miembros (
  id              uuid primary key default gen_random_uuid(),
  organizacion_id uuid not null references organizaciones(id) on delete cascade,
  usuario_id      uuid not null,
  rol             rol_miembro not null default 'solo_lectura',
  creado_en       timestamptz not null default now(),
  unique (organizacion_id, usuario_id)
);

create index on miembros (usuario_id);

-- ---------------------------------------------------------------------------
-- Helpers de autorización
--
-- STABLE + SECURITY DEFINER: se evalúan una vez por consulta y pueden leer
-- `miembros` sin recursión de políticas.
-- ---------------------------------------------------------------------------

create or replace function app_organizaciones_del_usuario()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select organizacion_id from miembros where usuario_id = auth.uid()
$$;

create or replace function app_es_miembro(org uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from miembros
    where usuario_id = auth.uid() and organizacion_id = org
  )
$$;

create or replace function app_tiene_rol(org uuid, roles rol_miembro[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from miembros
    where usuario_id = auth.uid()
      and organizacion_id = org
      and rol = any(roles)
  )
$$;

-- ---------------------------------------------------------------------------
-- Políticas RLS
-- ---------------------------------------------------------------------------

alter table organizaciones enable row level security;
alter table sucursales     enable row level security;
alter table miembros       enable row level security;

-- Forzada también para el dueño de la tabla: sin esto, el rol propietario del
-- esquema haría bypass silencioso de las políticas.
alter table organizaciones force row level security;
alter table sucursales     force row level security;
alter table miembros       force row level security;

create policy org_lectura on organizaciones
  for select using (app_es_miembro(id));

create policy org_escritura on organizaciones
  for update using (app_tiene_rol(id, array['propietario']::rol_miembro[]))
  with check (app_tiene_rol(id, array['propietario']::rol_miembro[]));

create policy sucursales_lectura on sucursales
  for select using (app_es_miembro(organizacion_id));

create policy sucursales_escritura on sucursales
  for all
  using (app_tiene_rol(organizacion_id, array['propietario','gerente']::rol_miembro[]))
  with check (app_tiene_rol(organizacion_id, array['propietario','gerente']::rol_miembro[]));

create policy miembros_lectura on miembros
  for select using (app_es_miembro(organizacion_id));

create policy miembros_escritura on miembros
  for all
  using (app_tiene_rol(organizacion_id, array['propietario']::rol_miembro[]))
  with check (app_tiene_rol(organizacion_id, array['propietario']::rol_miembro[]));
