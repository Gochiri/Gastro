-- test_rls_estructura.sql — Chequeo estructural. Se ejecuta como superusuario.
--
-- Recorre el esquema y exige que TODA tabla con organizacion_id tenga RLS
-- activado y forzado. Es el test que atrapa la tabla nueva que alguien agrega
-- en seis meses sin política: no depende de que nadie recuerde actualizar
-- una lista.
\set ON_ERROR_STOP on

do $$
declare t record; faltantes text := '';
begin
  for t in
    select c.relname,
           c.relrowsecurity  as rls_on,
           c.relforcerowsecurity as rls_forced,
           (select count(*) from pg_policy p where p.polrelid = c.oid) as politicas
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
      and exists (
        select 1 from information_schema.columns col
        where col.table_schema = 'public'
          and col.table_name = c.relname
          and col.column_name = 'organizacion_id'
      )
  loop
    if not t.rls_on then
      faltantes := faltantes || format(E'\n  - %s: RLS DESACTIVADO', t.relname);
    elsif not t.rls_forced then
      faltantes := faltantes || format(E'\n  - %s: falta FORCE ROW LEVEL SECURITY', t.relname);
    elsif t.politicas = 0 then
      faltantes := faltantes || format(E'\n  - %s: RLS activo pero sin políticas', t.relname);
    else
      raise notice 'ok  % (% políticas)', rpad(t.relname, 20), t.politicas;
    end if;
  end loop;

  if faltantes <> '' then
    raise exception 'Tablas multi-tenant sin protección: %', faltantes;
  end if;
end $$;

\echo 'test_rls_estructura: TODO OK'
