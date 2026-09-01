-- test_costeo.sql — Costeo recursivo contra valores calculados a mano.
-- Los esperados salen de un cálculo independiente del SQL (ver README).
\set ON_ERROR_STOP on

create or replace function pg_temp.igual(
  p_caso text, p_obtenido numeric, p_esperado numeric, p_tol numeric default 0.0001
) returns void language plpgsql as $$
begin
  if p_obtenido is null then
    raise exception 'FALLO [%]: obtenido NULL, esperado %', p_caso, p_esperado;
  end if;
  if abs(p_obtenido - p_esperado) > p_tol then
    raise exception 'FALLO [%]: obtenido %, esperado % (dif %)',
      p_caso, p_obtenido, p_esperado, abs(p_obtenido - p_esperado);
  end if;
  raise notice 'ok  %  = %', rpad(p_caso, 42), p_obtenido;
end $$;

create or replace function pg_temp.rid(p_nombre text) returns uuid language sql as $$
  select id from recetas
  where nombre = p_nombre and organizacion_id = '11111111-1111-1111-1111-111111111111'
$$;

do $$
declare f date := '2026-02-01';
begin
  -- Subreceta simple: tomate con 10% de merma + aceite + sal
  perform pg_temp.igual('salsa pomodoro (2000 ml)',
                        costo_receta(pg_temp.rid('Salsa Pomodoro'), f), 2987.7778);

  -- Anidamiento nivel 2: el ragú consume media elaboración de salsa
  perform pg_temp.igual('ragú de carne (3000 ml)',
                        costo_receta(pg_temp.rid('Ragú de carne'), f), 16410.2976);

  -- Anidamiento nivel 3: lasaña -> ragú -> salsa
  perform pg_temp.igual('lasaña (8 porciones)',
                        costo_receta(pg_temp.rid('Lasaña'), f), 16919.4345);
  perform pg_temp.igual('lasaña por porción',
                        costo_porcion(pg_temp.rid('Lasaña'), f), 2114.9293);

  -- Conversión entre dimensiones: aceite comprado por litro, usado en gramos
  perform pg_temp.igual('papas fritas (densidad l->g)',
                        costo_receta(pg_temp.rid('Papas fritas'), f), 747.7391);

  -- Conversión kg -> g en el precio unitario
  perform pg_temp.igual('precio unitario carne ($/g)',
                        app_precio_unitario(
                          (select id from insumos where nombre='Carne picada'
                           and organizacion_id='11111111-1111-1111-1111-111111111111'), f),
                        9.0);
end $$;

-- Precio histórico: el tomate sube el 2026-03-01. Costear a febrero debe usar
-- el precio viejo; a marzo, el nuevo. Si el histórico fuese destructivo, ambos
-- darían el mismo número.
do $$
declare c_feb numeric; c_mar numeric;
begin
  c_feb := costo_receta(pg_temp.rid('Salsa Pomodoro'), '2026-02-01');
  c_mar := costo_receta(pg_temp.rid('Salsa Pomodoro'), '2026-03-15');
  perform pg_temp.igual('salsa a febrero (tomate $8000/10kg)', c_feb, 2987.7778);
  -- tomate a 11000/10 kg = 1.10 $/g; 2000 g netos / 0.9 = 2222.2222 g brutos
  perform pg_temp.igual('salsa a marzo  (tomate $11000/10kg)', c_mar,
                        round(2222.2222222222 * 1.10 + 1200 + 10, 4), 0.001);
  if c_mar <= c_feb then
    raise exception 'FALLO: el precio histórico no se está aplicando por fecha';
  end if;
  raise notice 'ok  el costo sigue la fecha del precio (feb % -> mar %)', c_feb, c_mar;
end $$;

-- Detección de ciclos: si la salsa pasara a contener al ragú (que contiene a la
-- salsa), costear debe fallar con error explícito, no colgarse ni devolver un
-- número inventado.
do $$
declare ok boolean := false;
begin
  insert into receta_items (organizacion_id, receta_id, componente_tipo, subreceta_id, cantidad, unidad_id)
  values ('11111111-1111-1111-1111-111111111111',
          pg_temp.rid('Salsa Pomodoro'), 'receta', pg_temp.rid('Ragú de carne'),
          100, (select id from unidades where codigo='ml'));
  begin
    perform costo_receta(pg_temp.rid('Lasaña'), '2026-02-01');
  exception when others then
    if sqlerrm like '%ciclo%' then
      ok := true;
      raise notice 'ok  ciclo detectado: %', sqlerrm;
    else
      raise exception 'FALLO: se esperaba error de ciclo, llegó: %', sqlerrm;
    end if;
  end;
  if not ok then
    raise exception 'FALLO: una receta cíclica no produjo error';
  end if;
  -- deshacer para no ensuciar la base
  delete from receta_items
  where receta_id = pg_temp.rid('Salsa Pomodoro') and componente_tipo = 'receta';
end $$;

-- El desglose debe sumar exactamente el costo total y repartir 100%.
do $$
declare v_suma numeric; v_pct numeric; v_total numeric;
begin
  select sum(costo), sum(pct_del_total) into v_suma, v_pct
  from costo_receta_detalle(pg_temp.rid('Lasaña'), '2026-02-01');
  v_total := costo_receta(pg_temp.rid('Lasaña'), '2026-02-01');
  perform pg_temp.igual('desglose suma el total', v_suma, v_total, 0.01);
  perform pg_temp.igual('porcentajes suman 100', v_pct, 100, 0.05);
end $$;

\echo 'test_costeo: TODO OK'
