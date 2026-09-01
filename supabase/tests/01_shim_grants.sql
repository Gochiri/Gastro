-- 01_shim_grants.sql — SOLO PRUEBAS LOCALES / CI.
-- Permisos de tabla para app_user. RLS sigue filtrando por encima de esto:
-- GRANT concede acceso a la tabla, la política decide qué filas se ven.
grant select, insert, update, delete on all tables in schema public to app_user;
grant usage, select on all sequences in schema public to app_user;
grant execute on all functions in schema public to app_user;
grant execute on all functions in schema auth to app_user;
