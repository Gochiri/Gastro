-- test_rls_acceso.sql — Comportamiento real. Se ejecuta como app_user, un rol
-- SIN privilegios especiales: un superusuario ignora RLS y haría pasar en falso
-- todos estos casos.
\set ON_ERROR_STOP on

\set ORG_A '11111111-1111-1111-1111-111111111111'
\set ORG_B '22222222-2222-2222-2222-222222222222'
\set USR_A 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
\set USR_B 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
\set USR_RO 'dddddddd-dddd-dddd-dddd-dddddddddddd'

create or replace function pg_temp.entrar(p_usuario text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_usuario)::text, false)::void
$$;

-- Recorre todas las tablas multi-tenant y verifica que el usuario autenticado
-- no ve NI UNA fila de otra organización.
create or replace function pg_temp.sin_fugas(p_org_propia uuid) returns void
language plpgsql as $$
declare t record; n bigint; total bigint; revisadas int := 0;
begin
  for t in
    select table_name from information_schema.columns
    where table_schema = 'public' and column_name = 'organizacion_id'
    order by table_name
  loop
    execute format('select count(*) from public.%I where organizacion_id <> $1', t.table_name)
      into n using p_org_propia;
    if n > 0 then
      raise exception 'FUGA DE DATOS en %: % filas de otra organización visibles',
        t.table_name, n;
    end if;
    execute format('select count(*) from public.%I', t.table_name) into total;
    revisadas := revisadas + 1;
    raise notice 'ok  % : % filas, todas propias', rpad(t.table_name, 18), total;
  end loop;

  if revisadas = 0 then
    raise exception 'FALLO: no se revisó ninguna tabla (¿el esquema está vacío?)';
  end if;
end $$;

-- --- Usuario A: solo ve Cantina Norte -------------------------------------
select pg_temp.entrar(:'USR_A');
do $$ begin
  perform pg_temp.sin_fugas('11111111-1111-1111-1111-111111111111');
  if (select count(*) from recetas) = 0 then
    raise exception 'FALLO: el usuario A no ve sus propias recetas';
  end if;
  if exists (select 1 from recetas where nombre = 'Taco de canasta') then
    raise exception 'FUGA: el usuario A ve una receta de Bistró Sur';
  end if;
  raise notice 'ok  usuario A ve sus datos y ninguno ajeno';
end $$;

-- Las vistas son el agujero clásico: sin security_invoker se ejecutan con los
-- permisos de su dueño y hacen bypass de RLS.
do $$
declare n_vista bigint; n_tabla bigint;
begin
  select count(*) into n_vista from vista_recetas_costo;
  select count(*) into n_tabla from recetas;
  if n_vista <> n_tabla then
    raise exception 'FUGA: la vista muestra % filas y la tabla %', n_vista, n_tabla;
  end if;
  if exists (select 1 from vista_recetas_costo where nombre = 'Taco de canasta') then
    raise exception 'FUGA: vista_recetas_costo expone recetas de otra organización';
  end if;
  raise notice 'ok  vista_recetas_costo respeta RLS (% filas)', n_vista;
end $$;

-- --- Usuario B: solo ve Bistró Sur -----------------------------------------
select pg_temp.entrar(:'USR_B');
do $$ begin
  perform pg_temp.sin_fugas('22222222-2222-2222-2222-222222222222');
  if exists (select 1 from recetas where nombre = 'Lasaña') then
    raise exception 'FUGA: el usuario B ve una receta de Cantina Norte';
  end if;
  raise notice 'ok  usuario B ve sus datos y ninguno ajeno';
end $$;

-- --- Sin sesión: no ve nada ------------------------------------------------
select set_config('request.jwt.claims', '', false);
do $$
declare n bigint;
begin
  select count(*) into n from recetas;
  if n <> 0 then
    raise exception 'FALLO: sin autenticar se ven % recetas', n;
  end if;
  raise notice 'ok  sin sesión no se ve ninguna fila';
end $$;

-- --- Escritura cruzada: A no puede escribir en la organización de B --------
select pg_temp.entrar(:'USR_A');
do $$
declare bloqueado boolean := false;
begin
  begin
    insert into insumos (organizacion_id, nombre, unidad_base_id)
    values ('22222222-2222-2222-2222-222222222222', 'Insumo intruso',
            (select id from unidades where codigo = 'g'));
  exception when insufficient_privilege or check_violation then
    bloqueado := true;
  end;
  if not bloqueado then
    raise exception 'FALLO: el usuario A pudo insertar en la organización de B';
  end if;
  raise notice 'ok  escritura cruzada rechazada';
end $$;

-- --- Rol solo_lectura: ve pero no escribe ----------------------------------
select pg_temp.entrar(:'USR_RO');
do $$
declare bloqueado boolean := false; n bigint;
begin
  select count(*) into n from recetas;
  if n = 0 then
    raise exception 'FALLO: el rol solo_lectura no puede leer';
  end if;
  begin
    insert into insumos (organizacion_id, nombre, unidad_base_id)
    values ('11111111-1111-1111-1111-111111111111', 'Insumo de solo lectura',
            (select id from unidades where codigo = 'g'));
  exception when insufficient_privilege or check_violation then
    bloqueado := true;
  end;
  if not bloqueado then
    raise exception 'FALLO: el rol solo_lectura pudo insertar';
  end if;
  raise notice 'ok  solo_lectura lee (% recetas) pero no escribe', n;
end $$;

\echo 'test_rls_acceso: TODO OK'
