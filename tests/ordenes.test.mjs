import { strict as assert } from 'node:assert'
import { execFileSync } from 'node:child_process'
import test, { before, after } from 'node:test'
import pg from 'pg'

const admin = new pg.Pool({ connectionString: 'postgresql://postgres@localhost:5433/gastro' })
const sql = async (t, p = []) => (await admin.query(t, p)).rows
const ORG = '11111111-1111-1111-1111-111111111111'

let ordenId
let itemCarne
let itemQueso

before(async () => {
  execFileSync('./scripts/db.sh', ['reset'], { stdio: 'pipe' })
  execFileSync('node', ['scripts/escenario.mjs'], { stdio: 'pipe' })

  const [o] = await sql(
    `insert into ordenes_compra (organizacion_id, sucursal_id, proveedor_id, fecha, estado)
     select $1, (select id from sucursales where nombre = 'Casa Central'),
            (select id from proveedores where nombre = 'Frigorífico del Norte'),
            '2026-02-10', 'enviada'
     returning id`,
    [ORG],
  )
  ordenId = o.id

  for (const [insumo, cant] of [['Carne picada', 20], ['Queso mozzarella', 10]]) {
    const [it] = await sql(
      `insert into orden_items (organizacion_id, orden_id, insumo_id, cantidad, unidad_id)
       select $1, $2, i.id, $4, (select id from unidades where codigo = 'kg')
       from insumos i where i.nombre = $3 and i.organizacion_id = $1
       returning id`,
      [ORG, ordenId, insumo, cant],
    )
    if (insumo === 'Carne picada') itemCarne = it.id
    else itemQueso = it.id
  }
})

after(async () => {
  await admin.end()
})

async function recibir(items, actualizaPrecios = false, fecha = '2026-02-11') {
  const [r] = await sql(
    `insert into recepciones (organizacion_id, orden_id, fecha, actualiza_precios)
     values ($1, $2, $3::date, $4) returning id`,
    [ORG, ordenId, fecha, actualizaPrecios],
  )
  for (const [itemId, cantidad, costo] of items) {
    await sql(
      `insert into recepcion_items (organizacion_id, recepcion_id, orden_item_id, cantidad, unidad_id, costo_total)
       values ($1, $2, $3, $4, (select id from unidades where codigo = 'kg'), $5)`,
      [ORG, r.id, itemId, cantidad, costo],
    )
  }
  return (await sql('select * from confirmar_recepcion($1)', [r.id]))[0]
}

test('una recepción parcial deja la orden en estado parcial', async () => {
  const r = await recibir([[itemCarne, 10, 95000]])
  assert.equal(Number(r.compras_generadas), 1)
  assert.equal(r.estado_orden, 'parcial')

  const avance = await sql(
    'select insumo, pedido, recibido from vista_orden_avance where orden_id = $1 order by insumo',
    [ordenId],
  )
  const carne = avance.find((a) => a.insumo === 'Carne picada')
  assert.equal(Number(carne.pedido), 20000, 'el pedido se compara en la unidad base')
  assert.equal(Number(carne.recibido), 10000)
})

test('la recepción genera la compra que alimenta la varianza', async () => {
  const [c] = await sql(
    `select i.nombre, c.cantidad, c.costo_total, c.recepcion_id is not null as desde_recepcion
     from compras c join insumos i on i.id = c.insumo_id
     where c.recepcion_id is not null`,
  )
  assert.equal(c.nombre, 'Carne picada')
  assert.equal(Number(c.cantidad), 10)
  assert.equal(c.desde_recepcion, true, 'queda trazada a la recepción que la originó')
})

test('sin pedirlo, la recepción NO toca la lista de precios', async () => {
  const [{ count }] = await sql(
    `select count(*)::int from precios_insumo where vigente_desde = '2026-02-11'`,
  )
  assert.equal(count, 0,
    'una compra de urgencia cara no debe recostear el menú sin que nadie lo decida')
})

test('completar la orden la marca como recibida', async () => {
  const r = await recibir([[itemCarne, 10, 96000], [itemQueso, 10, 72000]], false, '2026-02-12')
  assert.equal(Number(r.compras_generadas), 2)
  assert.equal(r.estado_orden, 'recibida')

  const pendientes = await sql(
    'select * from vista_orden_avance where orden_id = $1 and recibido < pedido - 0.0001',
    [ordenId],
  )
  assert.equal(pendientes.length, 0)
})

test('pedirlo explícitamente sí actualiza el precio de referencia', async () => {
  const [item] = await sql(
    `insert into orden_items (organizacion_id, orden_id, insumo_id, cantidad, unidad_id)
     select $1, $2, i.id, 5, (select id from unidades where codigo = 'kg')
     from insumos i where i.nombre = 'Cebolla' and i.organizacion_id = $1
     returning id`,
    [ORG, ordenId],
  )
  const antes = await sql(
    `select app_precio_unitario(i.id, '2026-02-13') as precio
     from insumos i where i.nombre = 'Cebolla' and i.organizacion_id = $1`,
    [ORG],
  )

  await recibir([[item.id, 5, 15000]], true, '2026-02-13')

  const despues = await sql(
    `select app_precio_unitario(i.id, '2026-02-13') as precio
     from insumos i where i.nombre = 'Cebolla' and i.organizacion_id = $1`,
    [ORG],
  )
  // 15.000 por 5 kg = 3 $/g, contra 1,20 $/g anterior.
  assert.equal(Number(despues[0].precio).toFixed(2), '3.00')
  assert.ok(Number(despues[0].precio) > Number(antes[0].precio))
})

test('una recepción ya confirmada no se puede confirmar de nuevo', async () => {
  const [r] = await sql(
    `select id from recepciones where confirmada_en is not null limit 1`,
  )
  await assert.rejects(
    () => sql('select * from confirmar_recepcion($1)', [r.id]),
    /ya fue confirmada/,
    'confirmar dos veces duplicaría la mercadería recibida',
  )
})

test('una recepción sin ítems se rechaza', async () => {
  const [r] = await sql(
    `insert into recepciones (organizacion_id, orden_id, fecha) values ($1, $2, '2026-02-14')
     returning id`,
    [ORG, ordenId],
  )
  await assert.rejects(() => sql('select * from confirmar_recepcion($1)', [r.id]), /sin ítems/)
})
