-- 00_shim_auth.sql — SOLO PRUEBAS LOCALES / CI.
-- Supabase ya provee el esquema `auth` y auth.uid(); un Postgres limpio no.
-- Reproduce el contrato: auth.uid() devuelve el claim `sub` del JWT, que en
-- los tests se simula con set_config('request.jwt.claims', ...).

create schema if not exists auth;

create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(
    coalesce(
      current_setting('request.jwt.claim.sub', true),
      (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
    ),
    ''
  )::uuid
$$;

-- Rol de aplicación sin privilegios especiales. Probar RLS con un superusuario
-- no prueba nada: ignora las políticas y los tests pasarían en falso.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'app_user') then
    create role app_user login password 'test';
  end if;
end
$$;

grant usage on schema public, auth to app_user;
