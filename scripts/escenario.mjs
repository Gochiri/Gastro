/**
 * Carga un escenario completo de demostración y pruebas:
 *   1. Importa las ventas del CSV de ejemplo usando el importador real.
 *   2. Crea un conteo de apertura, compras del período y un conteo de cierre.
 *   3. Registra una merma.
 *
 * El conteo de cierre se construye a partir del consumo teórico calculado por
 * la propia base, y le resta un FALTANTE DELIBERADO de 2 kg de carne picada.
 * De esos, 0,5 kg quedan registrados como merma. El informe de varianza debe
 * encontrar exactamente 1,5 kg sin explicación.
 *
 * Uso: node scripts/escenario.mjs
 */
import { readFileSync } from 'node:fs'
import pg from 'pg'

process.env.DATABASE_URL ??= 'postgresql://app_user:test@localhost:5433/gastro'

const { cargarCsv, filasPendientes, asignarProducto, confirmarImportacion } =
  await import('../consultas/ventas.ts')
const { inspeccionar } = await import('../lib/csv.ts')
const { cerrarPool } = await import('../lib/db.ts')

const USUARIO = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const ORG = '11111111-1111-1111-1111-111111111111'
const SUCURSAL = '11111111-0000-0000-0000-000000000001'
const APERTURA = '2026-02-01T08:00:00-03:00'
const CIERRE = '2026-02-08T08:00:00-03:00'

/** Faltante plantado, en gramos, y cuánto de eso se registra como merma. */
export const FALTANTE_CARNE_G = 2000
export const MERMA_CARNE_G = 500

/**
 * Personal. Las cargas sociales son parte del costo real de una hora: sin
 * ellas el prime cost sale un tercio más bajo de lo que es.
 */
const EMPLEADOS = [
  { nombre: 'Marta Ruiz',   puesto: 'Cocina',    costoHora: 3000, cargas: 35 },
  { nombre: 'Diego Paz',    puesto: 'Salón',     costoHora: 2200, cargas: 35 },
  { nombre: 'Lucía Bravo',  puesto: 'Encargada', costoHora: 4500, cargas: 35 },
]

/**
 * Fichajes del período. Incluyen dos casos que hay que poder verificar:
 *   - un turno que cruza la medianoche (debe contar en el día que arrancó)
 *   - un fichaje sin cerrar (no se cuesta, pero se informa)
 */
const FICHAJES = [
  ['Marta Ruiz',  '2026-02-05T10:00:00-03:00', '2026-02-05T18:00:00-03:00'],
  ['Marta Ruiz',  '2026-02-06T10:00:00-03:00', '2026-02-06T18:00:00-03:00'],
  ['Marta Ruiz',  '2026-02-07T10:00:00-03:00', '2026-02-07T18:00:00-03:00'],
  ['Diego Paz',   '2026-02-05T12:00:00-03:00', '2026-02-05T20:00:00-03:00'],
  ['Diego Paz',   '2026-02-06T12:00:00-03:00', '2026-02-06T20:00:00-03:00'],
  // Cruza la medianoche: pertenece al 7 de febrero, no al 8.
  ['Diego Paz',   '2026-02-07T22:00:00-03:00', '2026-02-08T02:00:00-03:00'],
  ['Lucía Bravo', '2026-02-05T09:00:00-03:00', '2026-02-05T15:00:00-03:00'],
  ['Lucía Bravo', '2026-02-06T09:00:00-03:00', '2026-02-06T15:00:00-03:00'],
  // Sin cerrar: alguien se olvidó de fichar la salida.
  ['Lucía Bravo', '2026-02-07T09:00:00-03:00', null],
]

const admin = new pg.Pool({ connectionString: 'postgresql://postgres@localhost:5433/gastro' })
const sql = async (t, p = []) => (await admin.query(t, p)).rows

/** Insumos que se cuentan. Conteo PARCIAL a propósito: los caros. */
const CONTADOS = ['Carne picada', 'Queso mozzarella', 'Tomate perita', 'Pasta láminas']

/** Compras del período, en la unidad de compra habitual. */
const COMPRAS = [
  ['Carne picada', 10, 'kg'],
  ['Queso mozzarella', 5, 'kg'],
  ['Tomate perita', 20, 'kg'],
  ['Pasta láminas', 3000, 'g'],
]

/** Stock de apertura, en unidad base. */
const APERTURA_G = {
  'Carne picada': 4000,
  'Queso mozzarella': 3000,
  'Tomate perita': 8000,
  'Pasta láminas': 2000,
}

async function importarVentas() {
  const csv = readFileSync(new URL('../supabase/seed/ventas-ejemplo.csv', import.meta.url), 'utf8')
  const insp = inspeccionar(csv)
  const carga = await cargarCsv(USUARIO, {
    nombreArchivo: 'ventas-ejemplo.csv',
    contenido: csv,
    mapeo: insp.mapeoSugerido,
    formato: insp.formatoDetectado,
    sucursalId: SUCURSAL,
  })
  const pendientes = await filasPendientes(USUARIO, carga.importacionId)
  const [hamburguesa] = await sql(`select id from productos where nombre = 'Hamburguesa clásica'`)
  for (const p of pendientes) {
    await asignarProducto(USUARIO, p.id, hamburguesa.id)
  }
  return confirmarImportacion(USUARIO, carga.importacionId)
}

async function crearConteo(momento, tipo, cantidadesEnBase) {
  const [c] = await sql(
    `insert into conteos (organizacion_id, sucursal_id, tipo, momento, creado_por)
     values ($1, $2, $3, $4, $5) returning id`,
    [ORG, SUCURSAL, tipo, momento, USUARIO],
  )
  for (const [insumo, cantidad] of Object.entries(cantidadesEnBase)) {
    await sql(
      `insert into conteo_items (organizacion_id, conteo_id, insumo_id, cantidad, unidad_id)
       select $1, $2, i.id, $4, i.unidad_base_id
       from insumos i where i.nombre = $3 and i.organizacion_id = $1`,
      [ORG, c.id, insumo, cantidad],
    )
  }
  await sql('select cerrar_conteo($1)', [c.id])
  return c.id
}

async function main() {
  const ventas = await importarVentas()

  const idApertura = await crearConteo(APERTURA, 'apertura', APERTURA_G)

  for (const [insumo, cantidad, unidad] of COMPRAS) {
    await sql(
      `insert into compras (organizacion_id, sucursal_id, insumo_id, fecha, cantidad, unidad_id, costo_total)
       select $1, $2, i.id, '2026-02-03', $4, u.id,
              $4 * app_precio_unitario(i.id, '2026-02-03')
                 * (app_convertir(1, u.id, i.unidad_base_id, i.densidad_g_ml))
       from insumos i, unidades u
       where i.nombre = $3 and i.organizacion_id = $1 and u.codigo = $5`,
      [ORG, SUCURSAL, insumo, cantidad, unidad],
    )
  }

  // Merma registrada: parte del faltante SÍ tiene explicación.
  await sql(
    `insert into mermas (organizacion_id, sucursal_id, insumo_id, fecha, cantidad, unidad_id, motivo, notas)
     select $1, $2, i.id, '2026-02-06', $3, i.unidad_base_id, 'error_cocina',
            'Tanda de ragú quemada'
     from insumos i where i.nombre = 'Carne picada' and i.organizacion_id = $1`,
    [ORG, SUCURSAL, MERMA_CARNE_G],
  )

  // El cierre = apertura + compras − consumo teórico − faltante plantado.
  const teorico = Object.fromEntries(
    (await sql(`select insumo, cantidad from consumo_teorico_insumos('2026-02-01','2026-02-08')`))
      .map((r) => [r.insumo, Number(r.cantidad)]),
  )
  const compradoBase = Object.fromEntries(
    (await sql(
      `select i.nombre, sum(app_convertir(c.cantidad, c.unidad_id, i.unidad_base_id, i.densidad_g_ml)) as base
       from compras c join insumos i on i.id = c.insumo_id group by i.nombre`,
    )).map((r) => [r.nombre, Number(r.base)]),
  )

  const cierre = {}
  for (const insumo of CONTADOS) {
    const faltante = insumo === 'Carne picada' ? FALTANTE_CARNE_G : 0
    cierre[insumo] =
      APERTURA_G[insumo] + (compradoBase[insumo] ?? 0) - (teorico[insumo] ?? 0) - faltante
  }
  const idCierre = await crearConteo(CIERRE, 'cierre', cierre)

  // --- Personal ------------------------------------------------------------
  for (const e of EMPLEADOS) {
    await sql(
      `insert into empleados (organizacion_id, sucursal_id, nombre, puesto, costo_hora, cargas_sociales_pct)
       values ($1, $2, $3, $4, $5, $6)`,
      [ORG, SUCURSAL, e.nombre, e.puesto, e.costoHora, e.cargas],
    )
  }

  let abiertos = 0
  for (const [nombre, entrada, salida] of FICHAJES) {
    const [f] = await sql(
      `insert into fichajes (organizacion_id, sucursal_id, empleado_id, entrada, fecha_operativa)
       select $1, $2, e.id, $4::timestamptz, current_date
       from empleados e where e.nombre = $3 and e.organizacion_id = $1
       returning id`,
      [ORG, SUCURSAL, nombre, entrada],
    )
    if (salida) {
      await sql('select cerrar_fichaje($1, $2::timestamptz)', [f.id, salida])
    } else {
      abiertos += 1
    }
  }

  console.log(`ventas confirmadas: ${ventas.insertadas} (sin costo: ${ventas.sinCosto})`)
  console.log(`conteo apertura: ${idApertura}`)
  console.log(`conteo cierre:   ${idCierre}`)
  console.log(`faltante plantado: ${FALTANTE_CARNE_G} g de carne, ${MERMA_CARNE_G} g como merma`)
  console.log(`personal: ${EMPLEADOS.length} empleados, ${FICHAJES.length} fichajes (${abiertos} sin cerrar)`)
}

try {
  await main()
} finally {
  await admin.end()
  await cerrarPool()
}
