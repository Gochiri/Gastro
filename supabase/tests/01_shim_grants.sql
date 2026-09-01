-- 01_shim_grants.sql — SOLO PRUEBAS LOCALES / CI.
-- Permisos de tabla para app_user. RLS sigue filtrando por encima de esto:
-- GRANT concede acceso a la tabla, la política decide qué filas se ven.
grant select, insert, update, delete on all tables in schema public to app_user;
grant usage, select on all sequences in schema public to app_user;
grant execute on all functions in schema public to app_user;
grant execute on all functions in schema auth to app_user;

-- Lista de usuarios para el LOGIN DE DESARROLLO. Vive en el shim porque no debe
-- existir en producción: allí la autenticación es Supabase Auth y esta función
-- nunca se crea ni se llama (la app la invoca solo con APP_AUTH_DEV=1).
-- SECURITY DEFINER a propósito: la pantalla de login es previa a tener sesión,
-- así que RLS todavía no puede resolver nada.
create or replace function app_dev_usuarios()
returns table (usuario_id uuid, organizacion text, rol text)
language sql
stable
security definer
set search_path = public
as $$
  select m.usuario_id, o.nombre, m.rol::text
  from miembros m
  join organizaciones o on o.id = m.organizacion_id
  order by o.nombre, m.rol
$$;

grant execute on function app_dev_usuarios() to app_user;
