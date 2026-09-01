import { strict as assert } from 'node:assert'
import { execFileSync } from 'node:child_process'
import test, { before, after } from 'node:test'
import pg from 'pg'

process.env.DATABASE_URL ??= 'postgresql://app_user:test@localhost:5433/gastro'

const admin = new pg.Pool({ connectionString: 'postgresql://postgres@localhost:5433/gastro' })
const sql = async (t, p = []) => (await admin.query(t, p)).rows

before(() => {
  execFileSync('./scripts/db.sh', ['reset'], { stdio: 'pipe' })
  execFileSync('node', ['scripts/escenario.mjs'], { stdio: 'pipe' })
})

after(async () => {
  await admin.end()
})

test('el costo laboral coincide con el cálculo hecho a mano', async () => {
  // Turnos cerrados del escenario, con 35% de cargas sociales:
  //   Marta  (3000/h): 3 turnos x 8 h = 24 h -> 24 x 3000 x 1,35 =  97.200
  //   Diego  (2200/h): 8 + 8 + 4 h    = 20 h -> 20 x 2200 x 1,35 =  59.400
  //   Lucía  (4500/h): 2 turnos x 6 h = 12 h -> 12 x 4500 x 1,35 =  72.900
  //                                     56 h                       229.500
  const [r] = await sql(`select * from costo_laboral('2026-02-01','2026-02-28')`)
  assert.equal(Number(r.costo_total).toFixed(2), '229500.00')
  assert.equal(Number(r.horas).toFixed(2), '56.00')
  assert.equal(Number(r.fichajes_cerrados), 8)
})

test('las cargas sociales están incluidas, no son decorativas', async () => {
  const [sin] = await sql(
    `select round(sum(horas * costo_hora_aplicado), 2) as costo
     from vista_fichajes where not abierto`,
  )
  // Sin cargas serían 170.000: omitirlas subestima el costo laboral un 35%.
  assert.equal(Number(sin.costo).toFixed(2), '170000.00')
})

test('un turno que cruza la medianoche cuenta en el día que arrancó', async () => {
  // Diego entra 22:00 del 7 de febrero (hora de Buenos Aires) y sale 02:00 del 8.
  const [f] = await sql(
    `select fecha::text, horas from vista_fichajes where horas = 4`,
  )
  assert.equal(f.fecha, '2026-02-07',
    'con la zona del servidor en UTC caería en el 8 y el costo del día saldría mal')
  assert.equal(Number(f.horas), 4)
})

test('el fichaje sin cerrar se informa y no se cuesta', async () => {
  const [r] = await sql(`select * from costo_laboral('2026-02-01','2026-02-28')`)
  assert.equal(Number(r.fichajes_abiertos), 1)

  const [abierto] = await sql(`select costo, horas from vista_fichajes where abierto`)
  assert.equal(abierto.costo, null, 'no se sabe cuánto duró: no se inventa un costo')
  assert.equal(abierto.horas, null)
})

test('un empleado no puede tener dos fichajes abiertos', async () => {
  const [lucia] = await sql(`select id, organizacion_id from empleados where nombre = 'Lucía Bravo'`)
  await assert.rejects(
    () =>
      sql(
        `insert into fichajes (organizacion_id, empleado_id, entrada, fecha_operativa)
         values ($1, $2, now(), current_date)`,
        [lucia.organizacion_id, lucia.id],
      ),
    /fichaje_abierto_unico/,
  )
})

test('cerrar un fichaje congela la tarifa del momento', async () => {
  const [f] = await sql(
    `select id, costo_hora_aplicado from vista_fichajes
     where not abierto limit 1`,
  )
  const original = Number(f.costo_hora_aplicado)

  // Un aumento de sueldo no debe reescribir el costo de meses ya cerrados.
  await sql(`update empleados set costo_hora = costo_hora * 2`)
  const [despues] = await sql(`select costo_hora_aplicado from fichajes where id = $1`, [f.id])
  assert.equal(Number(despues.costo_hora_aplicado), original)

  await sql(`update empleados set costo_hora = costo_hora / 2`)
})

test('no se puede cerrar un fichaje con salida anterior a la entrada', async () => {
  const [abierto] = await sql(`select id, entrada from fichajes where salida is null`)
  await assert.rejects(
    () => sql(`select cerrar_fichaje($1, $2::timestamptz)`, [abierto.id, '2020-01-01T00:00:00Z']),
    /no puede ser anterior/,
  )
})

test('el prime cost usa el mismo food cost que el dashboard', async () => {
  const [p] = await sql(`select * from resumen_prime_cost('2026-02-01','2026-02-28')`)
  const [v] = await sql(`select food_cost_pct from resumen_ventas('2026-02-01','2026-02-28')`)

  assert.equal(
    Number(p.food_cost_pct).toFixed(2),
    Number(v.food_cost_pct).toFixed(2),
    'dos pantallas con el mismo rótulo y distinto número destruyen la confianza',
  )
  // Ventas costeadas calculadas directo, no reconstruidas desde un porcentaje
  // redondeado: 484.800 − 57.800 de cervezas sin receta.
  assert.equal(Number(p.ventas_costeadas).toFixed(2), '427000.00')
  assert.equal(Number(p.costo_laboral).toFixed(2), '229500.00')
  assert.equal(
    Number(p.prime_cost).toFixed(2),
    (Number(p.costo_comida) + Number(p.costo_laboral)).toFixed(2),
  )
})

test('el prime cost detecta un negocio que no cierra', async () => {
  const [p] = await sql(`select * from resumen_prime_cost('2026-02-01','2026-02-28')`)
  assert.ok(Number(p.prime_cost_pct) > 65,
    `con este costo laboral el negocio no cierra, prime cost fue ${p.prime_cost_pct}`)
  assert.equal(Number(p.fichajes_abiertos), 1, 'y avisa que faltan horas por contar')
})
