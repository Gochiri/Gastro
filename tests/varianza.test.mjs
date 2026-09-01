import { strict as assert } from 'node:assert'
import { execFileSync } from 'node:child_process'
import test, { before, after } from 'node:test'
import pg from 'pg'

/**
 * Varianza de food cost: el diferenciador del producto.
 *
 * Requiere base limpia. `scripts/escenario.mjs` importa las ventas del CSV con
 * el importador real, crea los conteos y planta un faltante conocido.
 */

const admin = new pg.Pool({ connectionString: 'postgresql://postgres@localhost:5433/gastro' })
const sql = async (t, p = []) => (await admin.query(t, p)).rows

let apertura
let cierre

before(() => {
  execFileSync('./scripts/db.sh', ['reset'], { stdio: 'ignore' })
  execFileSync('node', ['scripts/escenario.mjs'], { stdio: 'ignore' })
})

after(async () => {
  await admin.end()
})

const conteos = async () => {
  if (!apertura) {
    const filas = await sql(`select id, tipo from conteos order by momento`)
    apertura = filas.find((c) => c.tipo === 'apertura').id
    cierre = filas.find((c) => c.tipo === 'cierre').id
  }
  return [apertura, cierre]
}

test('el consumo teórico coincide con el cálculo hecho a mano', async () => {
  const filas = await sql(
    `select insumo, cantidad from consumo_teorico_insumos('2026-02-01','2026-02-08')`,
  )
  const porInsumo = Object.fromEntries(filas.map((f) => [f.insumo, Number(f.cantidad)]))

  // Carne picada, merma 5%. Ventas: 16 lasañas + 11 hamburguesas.
  //   Lasaña (rinde 8) -> Ragú 1500 ml de un lote de 3000 (factor 0,5).
  //   El ragú lleva 1,5 kg netos: 1500 x 0,5 / 0,95 = 789,4737 g por lote,
  //   98,6842 por porción, x 16 = 1578,9474
  //   Hamburguesa: 180 / 0,95 = 189,4737 x 11 = 2084,2105
  assert.equal(porInsumo['Carne picada'].toFixed(4), '3663.1579')

  // Mozzarella, merma 2%: lasaña 1632,6531 + hamburguesa 448,9796 + pizza 1428,5714
  assert.equal(porInsumo['Queso mozzarella'].toFixed(4), '3510.2041')
})

test('el tomate llega a la lasaña a través de dos subrecetas anidadas', async () => {
  // La lasaña no lleva tomate directamente: entra por Ragú -> Salsa Pomodoro.
  // Si la explosión recursiva fallara, el tomate no aparecería en absoluto.
  const [fila] = await sql(
    `select cantidad from consumo_teorico_insumos('2026-02-01','2026-02-08')
     where insumo = 'Tomate perita'`,
  )
  assert.ok(fila, 'el tomate debe aparecer aunque ninguna receta lo use directamente')
  assert.ok(Number(fila.cantidad) > 0)
})

test('encuentra el faltante plantado, y solo ese', async () => {
  const [ini, fin] = await conteos()
  const filas = await sql('select * from varianza_periodo($1, $2)', [ini, fin])

  const carne = filas.find((f) => f.insumo === 'Carne picada')
  // Se plantaron 2 kg de faltante; 0,5 kg quedaron anotados como merma.
  assert.equal(Number(carne.varianza_cantidad).toFixed(2), '2000.00')
  assert.equal(Number(carne.mermas_registradas).toFixed(2), '500.00')
  assert.equal(Number(carne.varianza_no_explicada).toFixed(2), '1500.00')
  // 1500 g x $9/g
  assert.equal(Number(carne.no_explicada_dinero).toFixed(2), '13500.00')

  // Ningún otro insumo debe inventar varianza.
  for (const f of filas.filter((x) => x.insumo !== 'Carne picada')) {
    assert.equal(
      Number(f.varianza_cantidad).toFixed(2),
      '0.00',
      `${f.insumo} no debería tener varianza`,
    )
  }
})

test('el informe ordena por dinero sin explicar, no por cantidad', async () => {
  const [ini, fin] = await conteos()
  const filas = await sql('select * from varianza_periodo($1, $2)', [ini, fin])
  assert.equal(filas[0].insumo, 'Carne picada', 'lo que más plata cuesta va primero')
})

test('un insumo contado en un solo conteo queda fuera del informe', async () => {
  const [ini, fin] = await conteos()
  // La cebolla se cuenta solo en la apertura.
  await sql(
    `insert into conteo_items (organizacion_id, conteo_id, insumo_id, cantidad, unidad_id)
     select i.organizacion_id, $1, i.id, 5000, i.unidad_base_id
     from insumos i where i.nombre = 'Cebolla'`,
    [ini],
  )
  const filas = await sql('select * from varianza_periodo($1, $2)', [ini, fin])
  assert.equal(
    filas.filter((f) => f.insumo === 'Cebolla').length,
    0,
    'asumir cero en el conteo que falta inventaría un faltante inexistente',
  )
  await sql(
    `delete from conteo_items where conteo_id = $1
      and insumo_id = (select id from insumos where nombre = 'Cebolla')`,
    [ini],
  )
})

test('el resumen declara qué parte del costo cubre el conteo', async () => {
  const [ini, fin] = await conteos()
  const [r] = await sql('select * from resumen_varianza($1, $2)', [ini, fin])

  assert.equal(Number(r.insumos_comparados), 4, 'se contaron 4 insumos, no los 40')
  assert.equal(Number(r.no_explicada_dinero).toFixed(2), '13500.00')

  // Conteo parcial: la cobertura tiene que ser menor al 100% y estar informada.
  const cobertura = Number(r.cobertura_pct)
  assert.ok(cobertura > 0 && cobertura < 100,
    `con conteo parcial la cobertura debe ser parcial, fue ${cobertura}`)

  // El food cost real tiene que ser mayor que el teórico: falta mercadería.
  assert.ok(
    Number(r.food_cost_real_pct) > Number(r.food_cost_teorico_pct),
    'con un faltante, el real debe superar al teórico',
  )

  // El teórico debe coincidir EXACTAMENTE con el que muestra el dashboard de
  // ventas. Dos pantallas con el mismo rótulo y distinto número destruyen la
  // confianza en ambas.
  const [rv] = await sql(`select food_cost_pct from resumen_ventas('2026-02-01','2026-02-08')`)
  assert.equal(
    Number(r.food_cost_teorico_pct).toFixed(2),
    Number(rv.food_cost_pct).toFixed(2),
    'el food cost teórico debe ser el mismo en ambas pantallas',
  )
})

test('no se puede calcular varianza con un conteo en borrador', async () => {
  const [c] = await sql(
    `insert into conteos (organizacion_id, sucursal_id, tipo, momento)
     select organizacion_id, id, 'ciclico', '2026-02-10T08:00:00-03:00'
     from sucursales where nombre = 'Casa Central' returning id`,
  )
  const [, fin] = await conteos()
  await assert.rejects(
    () => sql('select * from varianza_periodo($1, $2)', [fin, c.id]),
    /deben estar cerrados/,
    'un conteo en borrador todavía puede cambiar: la varianza saldría de datos provisorios',
  )
  await sql('delete from conteos where id = $1', [c.id])
})

test('el conteo final debe ser posterior al inicial', async () => {
  const [ini, fin] = await conteos()
  await assert.rejects(
    () => sql('select * from varianza_periodo($1, $2)', [fin, ini]),
    /no es posterior/,
  )
})

test('un conteo vacío no se puede cerrar', async () => {
  const [c] = await sql(
    `insert into conteos (organizacion_id, sucursal_id, tipo, momento)
     select organizacion_id, id, 'ciclico', '2026-02-11T08:00:00-03:00'
     from sucursales where nombre = 'Casa Central' returning id`,
  )
  await assert.rejects(() => sql('select cerrar_conteo($1)', [c.id]), /sin ningún insumo/)
  await sql('delete from conteos where id = $1', [c.id])
})
