-- seed.sql — Datos de un restaurante realista para desarrollo y tests.
--
-- Dos organizaciones: la segunda existe para probar el aislamiento entre
-- tenants. Los precios son órdenes de magnitud plausibles en ARS.
--
-- El bloque "Lasaña -> Ragú -> Salsa Pomodoro" está construido con números
-- redondos a propósito: su costo se verifica a mano en tests/test_costeo.sql.

-- ===========================================================================
-- Organizaciones y accesos
-- ===========================================================================

insert into organizaciones (id, nombre, pais, moneda, config_fiscal) values
  ('11111111-1111-1111-1111-111111111111', 'Cantina Norte', 'AR', 'ARS',
   '{"iva_general": 21, "iva_alimentos": 10.5}'),
  ('22222222-2222-2222-2222-222222222222', 'Bistró Sur',    'MX', 'MXN',
   '{"iva_general": 16}');

insert into sucursales (id, organizacion_id, nombre, direccion) values
  ('11111111-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Casa Central', 'Av. Corrientes 1234'),
  ('11111111-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Sucursal Palermo', 'Thames 800'),
  ('22222222-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Polanco', 'Masaryk 100');

-- ana@ (propietaria) y luis@ (compras) en Cantina Norte; sofia@ en Bistró Sur.
insert into miembros (organizacion_id, usuario_id, rol) values
  ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'propietario'),
  ('11111111-1111-1111-1111-111111111111', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'compras'),
  ('11111111-1111-1111-1111-111111111111', 'dddddddd-dddd-dddd-dddd-dddddddddddd', 'solo_lectura'),
  ('22222222-2222-2222-2222-222222222222', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'propietario');

insert into proveedores (id, organizacion_id, nombre, contacto) values
  ('11111111-0000-0000-0001-000000000001', '11111111-1111-1111-1111-111111111111', 'Distribuidora Central', 'ventas@central.example'),
  ('11111111-0000-0000-0001-000000000002', '11111111-1111-1111-1111-111111111111', 'Verdulería El Mercado', NULL),
  ('11111111-0000-0000-0001-000000000003', '11111111-1111-1111-1111-111111111111', 'Frigorífico del Norte', NULL),
  ('22222222-0000-0000-0001-000000000001', '22222222-2222-2222-2222-222222222222', 'Abarrotes MX', NULL);

-- ===========================================================================
-- Insumos de Cantina Norte
-- (nombre, categoría, unidad base, merma %, densidad g/ml)
-- ===========================================================================

insert into insumos (organizacion_id, nombre, categoria, unidad_base_id, merma_limpieza_pct, densidad_g_ml)
select '11111111-1111-1111-1111-111111111111', v.nombre, v.categoria,
       (select id from unidades where codigo = v.unidad), v.merma, v.densidad
from (values
  -- Verdulería: mermas altas, son las que más distorsionan el costo real
  ('Tomate perita',      'verduleria', 'g',  10.0, null),
  ('Cebolla',            'verduleria', 'g',  15.0, null),
  ('Ajo',                'verduleria', 'g',  25.0, null),
  ('Papa',               'verduleria', 'g',  20.0, null),
  ('Zanahoria',          'verduleria', 'g',  18.0, null),
  ('Morrón rojo',        'verduleria', 'g',  22.0, null),
  ('Lechuga',            'verduleria', 'g',  30.0, null),
  ('Albahaca fresca',    'verduleria', 'g',  35.0, null),
  ('Limón',              'verduleria', 'g',  40.0, null),
  ('Palta',              'verduleria', 'g',  28.0, null),
  ('Champiñones',        'verduleria', 'g',  12.0, null),
  ('Rúcula',             'verduleria', 'g',  25.0, null),
  -- Carnicería
  ('Carne picada',       'carniceria', 'g',   5.0, null),
  ('Bife de chorizo',    'carniceria', 'g',   8.0, null),
  ('Pollo entero',       'carniceria', 'g',  32.0, null),
  ('Pechuga de pollo',   'carniceria', 'g',   6.0, null),
  ('Panceta',            'carniceria', 'g',   4.0, null),
  ('Chorizo',            'carniceria', 'g',   2.0, null),
  -- Lácteos
  ('Queso mozzarella',   'lacteos',    'g',   2.0, null),
  ('Queso parmesano',    'lacteos',    'g',   3.0, null),
  ('Crema de leche',     'lacteos',    'ml',  0.0, null),
  ('Leche entera',       'lacteos',    'ml',  0.0, null),
  ('Manteca',            'lacteos',    'g',   1.0, null),
  ('Huevo',              'lacteos',    'u',   0.0, null),
  -- Almacén
  ('Pasta láminas',      'almacen',    'g',   0.0, null),
  ('Harina 0000',        'almacen',    'g',   0.0, null),
  ('Arroz carnaroli',    'almacen',    'g',   0.0, null),
  ('Sal fina',           'almacen',    'g',   0.0, null),
  ('Pimienta negra',     'almacen',    'g',   0.0, null),
  ('Orégano seco',       'almacen',    'g',   0.0, null),
  ('Azúcar',             'almacen',    'g',   0.0, null),
  ('Pan de hamburguesa', 'almacen',    'u',   0.0, null),
  ('Papas congeladas',   'almacen',    'g',   0.0, null),
  -- Aceites: se compran por volumen y se usan por peso -> requieren densidad
  ('Aceite de oliva',    'almacen',    'ml',  0.0, null),
  ('Aceite de girasol',  'almacen',    'g',   0.0, 0.92),
  -- Bebidas
  ('Vino tinto',         'bebidas',    'ml',  0.0, null),
  ('Cerveza rubia',      'bebidas',    'ml',  0.0, null),
  ('Gaseosa cola',       'bebidas',    'ml',  0.0, null),
  ('Agua mineral',       'bebidas',    'ml',  0.0, null),
  ('Café en grano',      'bebidas',    'g',   0.0, null)
) as v(nombre, categoria, unidad, merma, densidad);

-- ===========================================================================
-- Precios. Formato: "presentación de X unidades a $Y".
-- Dos fechas para el tomate: prueba que el histórico no es destructivo.
-- ===========================================================================

insert into precios_insumo (organizacion_id, insumo_id, proveedor_id, precio, cantidad_presentacion, unidad_id, vigente_desde)
select '11111111-1111-1111-1111-111111111111',
       (select id from insumos where nombre = v.insumo and organizacion_id = '11111111-1111-1111-1111-111111111111'),
       '11111111-0000-0000-0001-000000000001',
       v.precio, v.cantidad,
       (select id from unidades where codigo = v.unidad),
       v.desde::date
from (values
  -- Los cuatro insumos del bloque verificable a mano, con números redondos:
  ('Tomate perita',     8000.0,   10.0, 'kg', '2026-01-01'),
  ('Aceite de oliva',  12000.0,    1.0, 'l',  '2026-01-01'),
  ('Sal fina',           500.0,    1.0, 'kg', '2026-01-01'),
  ('Carne picada',      9000.0,    1.0, 'kg', '2026-01-01'),
  ('Cebolla',           1200.0,    1.0, 'kg', '2026-01-01'),
  ('Pasta láminas',     2500.0,  500.0, 'g',  '2026-01-01'),
  ('Queso mozzarella',  7000.0,    1.0, 'kg', '2026-01-01'),
  -- Aceite de girasol: bidón de 5 l, insumo medido en gramos (densidad 0.92)
  ('Aceite de girasol',25000.0,    5.0, 'l',  '2026-01-01'),
  -- Resto del catálogo
  ('Ajo',               3500.0,    1.0, 'kg', '2026-01-01'),
  ('Papa',              1100.0,    1.0, 'kg', '2026-01-01'),
  ('Zanahoria',          950.0,    1.0, 'kg', '2026-01-01'),
  ('Morrón rojo',       4200.0,    1.0, 'kg', '2026-01-01'),
  ('Lechuga',           1800.0,    1.0, 'kg', '2026-01-01'),
  ('Albahaca fresca',  12000.0,    1.0, 'kg', '2026-01-01'),
  ('Limón',             2200.0,    1.0, 'kg', '2026-01-01'),
  ('Palta',             6800.0,    1.0, 'kg', '2026-01-01'),
  ('Champiñones',       9500.0,    1.0, 'kg', '2026-01-01'),
  ('Rúcula',            7200.0,    1.0, 'kg', '2026-01-01'),
  ('Bife de chorizo',  18000.0,    1.0, 'kg', '2026-01-01'),
  ('Pollo entero',      4800.0,    1.0, 'kg', '2026-01-01'),
  ('Pechuga de pollo',  11000.0,   1.0, 'kg', '2026-01-01'),
  ('Panceta',          14000.0,    1.0, 'kg', '2026-01-01'),
  ('Chorizo',           8500.0,    1.0, 'kg', '2026-01-01'),
  ('Queso parmesano',  28000.0,    1.0, 'kg', '2026-01-01'),
  ('Crema de leche',    4500.0,    1.0, 'l',  '2026-01-01'),
  ('Leche entera',      1600.0,    1.0, 'l',  '2026-01-01'),
  ('Manteca',           9000.0,    1.0, 'kg', '2026-01-01'),
  ('Huevo',             4800.0,   30.0, 'u',  '2026-01-01'),
  ('Harina 0000',       1400.0,    1.0, 'kg', '2026-01-01'),
  ('Arroz carnaroli',   6500.0,    1.0, 'kg', '2026-01-01'),
  ('Pimienta negra',   32000.0,    1.0, 'kg', '2026-01-01'),
  ('Orégano seco',     18000.0,    1.0, 'kg', '2026-01-01'),
  ('Azúcar',            1300.0,    1.0, 'kg', '2026-01-01'),
  ('Pan de hamburguesa',4200.0,   12.0, 'u',  '2026-01-01'),
  ('Papas congeladas',  3800.0,    2.0, 'kg', '2026-01-01'),
  ('Vino tinto',        7500.0,  750.0, 'ml', '2026-01-01'),
  ('Cerveza rubia',     2100.0,  473.0, 'ml', '2026-01-01'),
  ('Gaseosa cola',      2800.0,   2.0,  'l',  '2026-01-01'),
  ('Agua mineral',      1500.0,   2.0,  'l',  '2026-01-01'),
  ('Café en grano',    24000.0,   1.0,  'kg', '2026-01-01')
) as v(insumo, precio, cantidad, unidad, desde);

-- Aumento de precio del tomate en marzo: el costeo a enero debe seguir usando
-- el precio viejo, y el costeo a marzo el nuevo.
insert into precios_insumo (organizacion_id, insumo_id, proveedor_id, precio, cantidad_presentacion, unidad_id, vigente_desde)
values ('11111111-1111-1111-1111-111111111111',
        (select id from insumos where nombre = 'Tomate perita' and organizacion_id = '11111111-1111-1111-1111-111111111111'),
        '11111111-0000-0000-0001-000000000002',
        11000.0, 10.0, (select id from unidades where codigo = 'kg'), '2026-03-01');

-- ===========================================================================
-- Recetas
-- ===========================================================================

create or replace function pg_temp.r(
  p_nombre text, p_tipo tipo_receta, p_rinde numeric, p_unidad text
) returns void language sql as $$
  insert into recetas (organizacion_id, nombre, tipo, rendimiento_cantidad, rendimiento_unidad_id)
  values ('11111111-1111-1111-1111-111111111111', p_nombre, p_tipo, p_rinde,
          (select id from unidades where codigo = p_unidad));
$$;

-- Item de insumo
create or replace function pg_temp.i(
  p_receta text, p_insumo text, p_cant numeric, p_unidad text
) returns void language sql as $$
  insert into receta_items (organizacion_id, receta_id, componente_tipo, insumo_id, cantidad, unidad_id)
  values ('11111111-1111-1111-1111-111111111111',
          (select id from recetas where nombre = p_receta and organizacion_id = '11111111-1111-1111-1111-111111111111'),
          'insumo',
          (select id from insumos  where nombre = p_insumo and organizacion_id = '11111111-1111-1111-1111-111111111111'),
          p_cant, (select id from unidades where codigo = p_unidad));
$$;

-- Item de subreceta
create or replace function pg_temp.s(
  p_receta text, p_sub text, p_cant numeric, p_unidad text
) returns void language sql as $$
  insert into receta_items (organizacion_id, receta_id, componente_tipo, subreceta_id, cantidad, unidad_id)
  values ('11111111-1111-1111-1111-111111111111',
          (select id from recetas where nombre = p_receta and organizacion_id = '11111111-1111-1111-1111-111111111111'),
          'receta',
          (select id from recetas where nombre = p_sub    and organizacion_id = '11111111-1111-1111-1111-111111111111'),
          p_cant, (select id from unidades where codigo = p_unidad));
$$;

\o /dev/null
-- --- Subrecetas -----------------------------------------------------------
select pg_temp.r('Salsa Pomodoro',     'subreceta', 2000, 'ml');
select pg_temp.i('Salsa Pomodoro', 'Tomate perita',    2, 'kg');
select pg_temp.i('Salsa Pomodoro', 'Aceite de oliva',100, 'ml');
select pg_temp.i('Salsa Pomodoro', 'Sal fina',        20, 'g');

select pg_temp.r('Ragú de carne',      'subreceta', 3000, 'ml');
select pg_temp.s('Ragú de carne', 'Salsa Pomodoro',1000, 'ml');
select pg_temp.i('Ragú de carne', 'Carne picada',   1.5, 'kg');
select pg_temp.i('Ragú de carne', 'Cebolla',        500, 'g');

select pg_temp.r('Masa de pizza',      'subreceta',    6, 'u');
select pg_temp.i('Masa de pizza', 'Harina 0000',      1, 'kg');
select pg_temp.i('Masa de pizza', 'Sal fina',        20, 'g');
select pg_temp.i('Masa de pizza', 'Aceite de oliva', 50, 'ml');

select pg_temp.r('Fondo de verduras',  'subreceta', 2000, 'ml');
select pg_temp.i('Fondo de verduras', 'Cebolla',   300, 'g');
select pg_temp.i('Fondo de verduras', 'Zanahoria', 200, 'g');
select pg_temp.i('Fondo de verduras', 'Ajo',        50, 'g');

-- --- Platos ---------------------------------------------------------------
-- Lasaña: tres niveles de anidamiento (Lasaña -> Ragú -> Salsa Pomodoro)
select pg_temp.r('Lasaña',            'plato', 8, 'u');
select pg_temp.s('Lasaña', 'Ragú de carne',   1500, 'ml');
select pg_temp.i('Lasaña', 'Pasta láminas',    600, 'g');
select pg_temp.i('Lasaña', 'Queso mozzarella', 800, 'g');

select pg_temp.r('Pizza Margarita',   'plato', 1, 'u');
select pg_temp.s('Pizza Margarita', 'Masa de pizza',    1, 'u');
select pg_temp.s('Pizza Margarita', 'Salsa Pomodoro', 150, 'ml');
select pg_temp.i('Pizza Margarita', 'Queso mozzarella',200, 'g');
select pg_temp.i('Pizza Margarita', 'Albahaca fresca',   5, 'g');

-- Papas fritas: usa aceite comprado por litro y medido en gramos (densidad)
select pg_temp.r('Papas fritas',      'plato', 1, 'u');
select pg_temp.i('Papas fritas', 'Papas congeladas', 250, 'g');
select pg_temp.i('Papas fritas', 'Aceite de girasol', 50, 'g');
select pg_temp.i('Papas fritas', 'Sal fina',           2, 'g');

select pg_temp.r('Hamburguesa clásica','plato', 1, 'u');
select pg_temp.i('Hamburguesa clásica', 'Pan de hamburguesa', 1, 'u');
select pg_temp.i('Hamburguesa clásica', 'Carne picada',     180, 'g');
select pg_temp.i('Hamburguesa clásica', 'Queso mozzarella',  40, 'g');
select pg_temp.i('Hamburguesa clásica', 'Lechuga',           20, 'g');
select pg_temp.i('Hamburguesa clásica', 'Tomate perita',     30, 'g');

select pg_temp.r('Ensalada César',    'plato', 1, 'u');
select pg_temp.i('Ensalada César', 'Lechuga',          150, 'g');
select pg_temp.i('Ensalada César', 'Pechuga de pollo', 120, 'g');
select pg_temp.i('Ensalada César', 'Queso parmesano',   20, 'g');
select pg_temp.i('Ensalada César', 'Huevo',              1, 'u');

select pg_temp.r('Risotto de champiñones','plato', 1, 'u');
select pg_temp.s('Risotto de champiñones', 'Fondo de verduras', 400, 'ml');
select pg_temp.i('Risotto de champiñones', 'Arroz carnaroli',   100, 'g');
select pg_temp.i('Risotto de champiñones', 'Champiñones',       120, 'g');
select pg_temp.i('Risotto de champiñones', 'Manteca',            20, 'g');
select pg_temp.i('Risotto de champiñones', 'Queso parmesano',    30, 'g');
select pg_temp.i('Risotto de champiñones', 'Vino tinto',         50, 'ml');

select pg_temp.r('Bife con papas',    'plato', 1, 'u');
select pg_temp.i('Bife con papas', 'Bife de chorizo',   350, 'g');
select pg_temp.i('Bife con papas', 'Papa',              300, 'g');
select pg_temp.i('Bife con papas', 'Aceite de girasol',  30, 'g');
select pg_temp.i('Bife con papas', 'Sal fina',            5, 'g');

select pg_temp.r('Pollo grillado',    'plato', 1, 'u');
select pg_temp.i('Pollo grillado', 'Pechuga de pollo', 250, 'g');
select pg_temp.i('Pollo grillado', 'Aceite de oliva',   20, 'ml');
select pg_temp.i('Pollo grillado', 'Limón',             30, 'g');
select pg_temp.i('Pollo grillado', 'Sal fina',           3, 'g');

select pg_temp.r('Pasta bolognesa',   'plato', 1, 'u');
select pg_temp.s('Pasta bolognesa', 'Ragú de carne',  400, 'ml');
select pg_temp.i('Pasta bolognesa', 'Pasta láminas',  150, 'g');
select pg_temp.i('Pasta bolognesa', 'Queso parmesano', 25, 'g');

select pg_temp.r('Sándwich de panceta','plato', 1, 'u');
select pg_temp.i('Sándwich de panceta', 'Pan de hamburguesa', 1, 'u');
select pg_temp.i('Sándwich de panceta', 'Panceta',           80, 'g');
select pg_temp.i('Sándwich de panceta', 'Queso mozzarella',  50, 'g');

select pg_temp.r('Ensalada de rúcula y palta','plato', 1, 'u');
select pg_temp.i('Ensalada de rúcula y palta', 'Rúcula',           80, 'g');
select pg_temp.i('Ensalada de rúcula y palta', 'Palta',           100, 'g');
select pg_temp.i('Ensalada de rúcula y palta', 'Limón',            20, 'g');
select pg_temp.i('Ensalada de rúcula y palta', 'Aceite de oliva',  15, 'ml');

select pg_temp.r('Café con leche',    'plato', 1, 'u');
select pg_temp.i('Café con leche', 'Café en grano',  18, 'g');
select pg_temp.i('Café con leche', 'Leche entera',  150, 'ml');

select pg_temp.r('Provoleta',         'plato', 1, 'u');
select pg_temp.i('Provoleta', 'Queso parmesano',   180, 'g');
select pg_temp.i('Provoleta', 'Orégano seco',        3, 'g');
select pg_temp.i('Provoleta', 'Aceite de oliva',    10, 'ml');

\o

-- ===========================================================================
-- Bistró Sur: datos mínimos, existen solo para probar el aislamiento
-- ===========================================================================

insert into insumos (organizacion_id, nombre, categoria, unidad_base_id, merma_limpieza_pct)
values ('22222222-2222-2222-2222-222222222222', 'Tortilla de maíz', 'almacen',
        (select id from unidades where codigo = 'u'), 0);

insert into precios_insumo (organizacion_id, insumo_id, precio, cantidad_presentacion, unidad_id, vigente_desde)
values ('22222222-2222-2222-2222-222222222222',
        (select id from insumos where nombre = 'Tortilla de maíz'),
        90.0, 30, (select id from unidades where codigo = 'u'), '2026-01-01');

insert into recetas (organizacion_id, nombre, tipo, rendimiento_cantidad, rendimiento_unidad_id)
values ('22222222-2222-2222-2222-222222222222', 'Taco de canasta', 'plato', 1,
        (select id from unidades where codigo = 'u'));

insert into receta_items (organizacion_id, receta_id, componente_tipo, insumo_id, cantidad, unidad_id)
values ('22222222-2222-2222-2222-222222222222',
        (select id from recetas where nombre = 'Taco de canasta'),
        'insumo',
        (select id from insumos where nombre = 'Tortilla de maíz'),
        2, (select id from unidades where codigo = 'u'));
