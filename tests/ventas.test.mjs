import { strict as assert } from 'node:assert'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import test, { before, after } from 'node:test'
import pg from 'pg'

process.env.DATABASE_URL ??= 'postgresql://app_user:test@localhost:5433/gastro'

const { cargarCsv, filasPendientes, asignarProducto, confirmarImportacion } =
  await import('../consultas/ventas.ts')
const { inspeccionar } = await import('../lib/csv.ts')
const { cerrarPool } = await import('../lib/db.ts')

/**
 * Los tests de este archivo comparten estado y corren EN ORDEN: importan una
 * vez y van verificando el resultado. Requieren una base recién creada
 * (`./scripts/db.sh reset`), que es lo que hace scripts/test.sh.
 */
const USUARIO = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const CSV = readFileSync(new URL('../supabase/seed/ventas-ejemplo.csv', import.meta.url), 'utf8')

/** Consulta como superusuario, para preparar y verificar sin pasar por RLS. */
const admin = new pg.Pool({ connectionString: 'postgresql://postgres@localhost:5433/gastro' })
const sql = async (texto, params = []) => (await admin.query(texto, params)).rows

// Base propia: este archivo importa un CSV cuyo hash impide reimportarlo, así
// que no puede correr sobre una base que ya lo tenga. Recrearla acá lo hace
// independiente del orden en que se ejecuten los archivos de test.
before(() => {
  execFileSync('./scripts/db.sh', ['reset'], { stdio: 'pipe' })
})

after(async () => {
  await admin.end()
  await cerrarPool()
})

async function importarTodo() {
  const insp = inspeccionar(CSV)
  const carga = await cargarCsv(USUARIO, {
    nombreArchivo: 'ventas-ejemplo.csv',
    contenido: CSV,
    mapeo: insp.mapeoSugerido,
    formato: insp.formatoDetectado,
  })
  return { insp, carga }
}

test('el CSV sucio entra: 13 filas listas y 1 producto desconocido', async () => {
  const { carga } = await importarTodo()
  assert.equal(carga.total, 14, 'la fila vacía no cuenta')
  assert.equal(carga.sinProducto, 1, 'solo "Milanesa napolitana" es desconocido')
  assert.equal(carga.conError, 0, 'ninguna fila queda inutilizable')
  assert.equal(carga.ok, 13)
})

test('LASAÑA y HAMBURGUESA CLASICA se resuelven sin intervención', async () => {
  const filas = await sql(
    `select s.texto_producto, p.nombre
     from ventas_staging s join productos p on p.id = s.producto_id
     where s.texto_producto in ('LASAÑA', 'HAMBURGUESA CLASICA')`,
  )
  assert.equal(filas.length, 2, 'mayúsculas y acentos faltantes no deben frenar la importación')
  assert.equal(filas.find((f) => f.texto_producto === 'LASAÑA').nombre, 'Lasaña')
  assert.equal(
    filas.find((f) => f.texto_producto === 'HAMBURGUESA CLASICA').nombre,
    'Hamburguesa clásica',
  )
})

test('el producto desconocido queda pendiente, sin sugerencias forzadas', async () => {
  const [imp] = await sql(`select id from importaciones order by creada_en desc limit 1`)
  const pendientes = await filasPendientes(USUARIO, imp.id)
  assert.equal(pendientes.length, 1)
  assert.equal(pendientes[0].textoProducto, 'Milanesa napolitana')
  // "Milanesa napolitana" no se parece a nada del catálogo (el mejor candidato
  // llega a 0,09). Proponerlo igual sería empujar a un emparejado equivocado,
  // que mete ventas en el plato erróneo y corrompe el food cost en silencio.
  assert.equal(pendientes[0].sugerencias.length, 0,
    'sin parecido real, mejor no sugerir nada')
})

test('las variantes de escritura sí obtienen sugerencias', async () => {
  const casos = [
    ['Lasagna', 'Lasaña'],
    ['Papas fritas grandes', 'Papas fritas'],
    ['Pizza margarita chica', 'Pizza Margarita'],
  ]
  for (const [texto, esperado] of casos) {
    const filas = await sql('select nombre from proponer_productos($1, 1)', [texto])
    assert.equal(filas[0]?.nombre, esperado, `"${texto}" debería sugerir "${esperado}"`)
  }
})

test('no se puede confirmar con filas sin resolver', async () => {
  const [imp] = await sql(`select id from importaciones order by creada_en desc limit 1`)
  await assert.rejects(
    () => confirmarImportacion(USUARIO, imp.id),
    /sin producto asignado/,
    'confirmar dejando filas sin resolver perdería esas ventas en silencio',
  )
})

test('resolver a mano y confirmar congela costo y comisión', async () => {
  const [imp] = await sql(`select id from importaciones order by creada_en desc limit 1`)
  const [pendiente] = await filasPendientes(USUARIO, imp.id)
  const [hamburguesa] = await sql(
    `select id from productos where nombre = 'Hamburguesa clásica'`,
  )

  await asignarProducto(USUARIO, pendiente.id, hamburguesa.id)
  const resultado = await confirmarImportacion(USUARIO, imp.id)

  assert.equal(resultado.insertadas, 14, 'las 14 ventas quedan cargadas')
  assert.equal(resultado.sinCosto, 2, 'las dos ventas de cerveza no tienen receta')

  const [v] = await sql(
    `select count(*) filter (where costo_unitario_teorico is not null) as costeadas,
            count(*) filter (where comision_pct_aplicada = 28) as por_rappi,
            count(*) filter (where costeada_en is null) as sin_marca
     from ventas`,
  )
  assert.equal(Number(v.costeadas), 12)
  assert.equal(Number(v.por_rappi), 3, 'las tres ventas por Rappi guardan su 28%')
  assert.equal(Number(v.sin_marca), 0, 'toda venta registra cuándo se costeó')
})

test('la corrección se recuerda: el alias queda guardado', async () => {
  const [alias] = await sql(
    `select p.nombre from alias_producto a join productos p on p.id = a.producto_id
     where a.texto_normalizado = app_normalizar_texto('Milanesa napolitana')`,
  )
  assert.equal(alias?.nombre, 'Hamburguesa clásica',
    'la próxima importación debe resolverlo sin volver a preguntar')
})

test('los KPIs coinciden con el cálculo hecho a mano', async () => {
  // Valores calculados de forma independiente al SQL (ver README de la fase).
  const [r] = await sql(`select * from resumen_ventas('2026-02-01', '2026-02-28')`)
  assert.equal(Number(r.ventas_brutas), 484800, 'ventas netas de descuentos')
  assert.equal(Number(r.comisiones), 37139, 'comisiones de Rappi y PedidosYa')
  assert.equal(Number(r.costo_teorico).toFixed(2), '88467.71')
  assert.equal(Number(r.margen).toFixed(2), '359193.29')
  assert.equal(Number(r.food_cost_pct).toFixed(2), '20.72')
  assert.equal(Number(r.cobertura_pct).toFixed(2), '88.08',
    'el 12% restante son las cervezas sin receta')
})

test('el mismo plato rinde menos por Rappi que en salón', async () => {
  const filas = await sql(
    `select canal, round(margen / unidades, 2) as margen_unitario
     from vista_margen_producto_canal
     where producto = 'Lasaña' and canal in ('Salón', 'Rappi')`,
  )
  const salon = Number(filas.find((f) => f.canal === 'Salón').margen_unitario)
  const rappi = Number(filas.find((f) => f.canal === 'Rappi').margen_unitario)

  // Valores exactos, calculados a mano:
  //   Rappi: 42000/3 = 14000 por unidad; menos 28% de comisión = 10080;
  //          menos 2114,9293 de costo -> 7965,07
  //   Salón: 152600/11 = 13872,73 (incluye una fila con descuento);
  //          menos 2114,9293 -> 11757,80
  assert.equal(rappi.toFixed(2), '7965.07')
  assert.equal(salon.toFixed(2), '11757.80')

  // La comisión se lleva casi cuatro mil pesos de cada porción vendida por
  // Rappi. Ese es el hallazgo que justifica la fase.
  assert.ok(rappi < salon, `Rappi (${rappi}) debe rendir menos que salón (${salon})`)
  assert.equal((salon - rappi).toFixed(2), '3792.73')
})

test('subir el mismo archivo otra vez se rechaza', async () => {
  const insp = inspeccionar(CSV)
  await assert.rejects(
    () => cargarCsv(USUARIO, {
      nombreArchivo: 'ventas-ejemplo.csv', contenido: CSV,
      mapeo: insp.mapeoSugerido, formato: insp.formatoDetectado,
    }),
    /ya se importó/,
  )
})

test('congelado: cambiar un precio no mueve las ventas ya importadas', async () => {
  const [antes] = await sql(`select round(sum(cantidad * costo_unitario_teorico), 2) as costo from ventas`)

  // El tomate se encarece con efecto retroactivo a principios de febrero.
  await sql(
    `insert into precios_insumo (organizacion_id, insumo_id, precio, cantidad_presentacion, unidad_id, vigente_desde)
     select organizacion_id, id, 20000, 10, (select id from unidades where codigo='kg'), '2026-02-01'
     from insumos where nombre = 'Tomate perita'`,
  )

  const [despues] = await sql(`select round(sum(cantidad * costo_unitario_teorico), 2) as costo from ventas`)
  assert.equal(despues.costo, antes.costo, 'un mes cerrado no cambia solo')

  // Pero recalcular a propósito sí lo actualiza.
  const [{ recalcular_costos_ventas: afectadas }] = await sql(
    `select recalcular_costos_ventas('2026-02-01', '2026-02-28')`,
  )
  assert.equal(Number(afectadas), 14)

  const [recalculado] = await sql(`select round(sum(cantidad * costo_unitario_teorico), 2) as costo from ventas`)
  assert.ok(Number(recalculado.costo) > Number(antes.costo),
    'tras recalcular, el costo refleja el precio nuevo')
})
