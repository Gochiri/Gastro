import { strict as assert } from 'node:assert'
import { execFileSync } from 'node:child_process'
import test, { before, after } from 'node:test'
import pg from 'pg'

process.env.DATABASE_URL ??= 'postgresql://app_user:test@localhost:5433/gastro'

const admin = new pg.Pool({ connectionString: 'postgresql://postgres@localhost:5433/gastro' })
const sql = async (t, p = []) => (await admin.query(t, p)).rows

const ORG = '11111111-1111-1111-1111-111111111111'
const CASA = '11111111-0000-0000-0000-000000000001'
const PALERMO = '11111111-0000-0000-0000-000000000002'
const FEB = ['2026-02-01', '2026-02-28']

before(() => {
  execFileSync('./scripts/db.sh', ['reset'], { stdio: 'pipe' })
  execFileSync('node', ['scripts/escenario.mjs'], { stdio: 'pipe' })
})

after(async () => {
  await admin.end()
})

// ---------------------------------------------------------------------------
// Planificado contra fichado
// ---------------------------------------------------------------------------

test('el desvío entre plan y fichaje coincide con el cálculo hecho a mano', async () => {
  // Plan del escenario, con 35% de cargas:
  //   Marta  (3000/h): 8+8+6+8 = 30 h -> 30 x 3000 x 1,35 = 121.500
  //   Diego  (2200/h): 8+8     = 16 h -> 16 x 2200 x 1,35 =  47.520
  //   Lucía  (4500/h): 6+8+6   = 20 h -> 20 x 4500 x 1,35 = 121.500
  //                              66 h                       290.520
  // Fichado real, ya verificado en la fase 4: 56 h y 229.500.
  const [r] = await sql(`select * from resumen_plan_vs_real($1,$2)`, FEB)
  assert.equal(Number(r.horas_plan).toFixed(2), '66.00')
  assert.equal(Number(r.horas_reales).toFixed(2), '56.00')
  assert.equal(Number(r.desvio_horas).toFixed(2), '-10.00')
  assert.equal(Number(r.costo_plan).toFixed(2), '290520.00')
  assert.equal(Number(r.costo_real).toFixed(2), '229500.00')
  assert.equal(Number(r.desvio_dinero).toFixed(2), '-61020.00')
  assert.equal(Number(r.desvio_pct).toFixed(2), '-21.00')
})

test('el costo real del plan es el mismo que el del costo laboral', async () => {
  // Dos pantallas con el mismo rótulo y distinto número destruyen la confianza
  // en ambas: el "fichado" de turnos tiene que ser el "costo laboral" de F4.
  const [p] = await sql(`select * from resumen_plan_vs_real($1,$2)`, FEB)
  const [l] = await sql(`select * from costo_laboral($1,$2)`, FEB)
  assert.equal(Number(p.costo_real).toFixed(2), Number(l.costo_total).toFixed(2))
  assert.equal(Number(p.horas_reales).toFixed(2), Number(l.horas).toFixed(2))
})

test('las cinco situaciones se distinguen', async () => {
  const filas = await sql(`select * from plan_vs_real($1,$2)`, FEB)
  const por = Object.fromEntries(filas.map((f) => [`${f.empleado}|${f.fecha.toISOString().slice(0, 10)}`, f]))

  // Fichó lo planificado.
  assert.equal(por['Marta Ruiz|2026-02-05'].situacion, 'en_plan')
  // Se planificaron 6 h y fichó 8.
  assert.equal(por['Marta Ruiz|2026-02-07'].situacion, 'excedido')
  assert.equal(Number(por['Marta Ruiz|2026-02-07'].desvio_horas), 2)
  // Se planificaron 8 h y fichó 6.
  assert.equal(por['Lucía Bravo|2026-02-06'].situacion, 'por_debajo')
  // Turno planificado y nadie fichó.
  assert.equal(por['Marta Ruiz|2026-02-08'].situacion, 'ausente')
  assert.equal(Number(por['Marta Ruiz|2026-02-08'].horas_reales), 0)
  // Fichó sin plan: el turno de noche que cruza la medianoche.
  assert.equal(por['Diego Paz|2026-02-07'].situacion, 'sin_planificar')
  assert.equal(Number(por['Diego Paz|2026-02-07'].horas_plan), 0)
})

test('un fichaje sin cerrar no se confunde con una ausencia', async () => {
  const filas = await sql(`select * from plan_vs_real($1,$2)`, FEB)
  const lucia = filas.find(
    (f) => f.empleado === 'Lucía Bravo' && f.fecha.toISOString().slice(0, 10) === '2026-02-07',
  )
  // Sus horas reales son 0 porque el turno no se cerró, no porque no vino.
  assert.equal(Number(lucia.horas_reales), 0)
  assert.equal(Number(lucia.fichajes_abiertos), 1,
    'sin este dato, un turno abierto se lee como una ausencia')
})

test('un turno fichado sin plan no desaparece del informe', async () => {
  // Es la razón del FULL JOIN: con un join común, las horas trabajadas fuera
  // del plan —que son justamente las que hay que mirar— no existirían.
  const filas = await sql(`select * from plan_vs_real($1,$2)`, FEB)
  const sinPlan = filas.filter((f) => f.situacion === 'sin_planificar')
  assert.equal(sinPlan.length, 1)
  assert.ok(Number(sinPlan[0].costo_real) > 0)
})

// ---------------------------------------------------------------------------
// Movimientos y stock teórico
// ---------------------------------------------------------------------------

test('el libro de movimientos no duplica ninguna fila de origen', async () => {
  const [{ compras, mermas, movs }] = await sql(
    `select (select count(*) from compras)  as compras,
            (select count(*) from mermas)   as mermas,
            (select count(*) from movimientos_manuales) as movs`,
  )
  const filas = await sql(`select tipo, count(*) as n from vista_movimientos_inventario group by tipo`)
  const por = Object.fromEntries(filas.map((f) => [f.tipo, Number(f.n)]))

  assert.equal(por.compra, Number(compras))
  assert.equal(por.merma, Number(mermas))
  // Una transferencia aparece dos veces, una por sucursal: es lo que la hace
  // neutra para la organización y visible para cada local.
  assert.equal(por.transferencia_salida, Number(movs))
  assert.equal(por.transferencia_entrada, Number(movs))
})

test('una transferencia es neutra para la organización', async () => {
  const [{ neto }] = await sql(
    `select coalesce(sum(cantidad), 0) as neto from vista_movimientos_inventario
     where tipo like 'transferencia%'`,
  )
  assert.equal(Number(neto), 0, 'lo que sale de un local entra en el otro')

  const [{ salida }] = await sql(
    `select sum(cantidad) as salida from vista_movimientos_inventario
     where tipo = 'transferencia_salida' and sucursal_id = $1`,
    [CASA],
  )
  const [{ entrada }] = await sql(
    `select sum(cantidad) as entrada from vista_movimientos_inventario
     where tipo = 'transferencia_entrada' and sucursal_id = $1`,
    [PALERMO],
  )
  assert.equal(Number(salida), -2000)
  assert.equal(Number(entrada), 2000)
})

test('una transferencia entre dos conteos NO se lee como consumo', async () => {
  // Es el riesgo que introduce la funcionalidad nueva sobre la métrica insignia
  // del producto: sin el término de movimientos en la varianza, sacar carne
  // hacia otra sucursal aparecería como un faltante sin explicar.
  const [{ id: insumoId }] = await sql(
    `select id from insumos where nombre = 'Carne picada' and organizacion_id = $1`,
    [ORG],
  )
  const [inicial] = await sql(`select id from conteos where tipo = 'apertura'`)
  const [final] = await sql(`select id from conteos where tipo = 'cierre'`)

  const antes = await sql(`select * from varianza_periodo($1, $2)`, [inicial.id, final.id])
  const carneAntes = antes.find((f) => f.insumo === 'Carne picada')
  assert.equal(Number(carneAntes.varianza_no_explicada), 1500)

  // Se transfieren 1.000 g DENTRO de la ventana entre los dos conteos.
  await sql(
    `insert into movimientos_manuales
       (organizacion_id, tipo, insumo_id, fecha, cantidad, unidad_id,
        sucursal_origen_id, sucursal_destino_id, motivo)
     select $1, 'transferencia', i.id, '2026-02-04', 1000, i.unidad_base_id, $2, $3,
            'Prueba: no debe leerse como consumo'
     from insumos i where i.id = $4`,
    [ORG, CASA, PALERMO, insumoId],
  )

  try {
    const despues = await sql(`select * from varianza_periodo($1, $2)`, [inicial.id, final.id])
    const carneDespues = despues.find((f) => f.insumo === 'Carne picada')

    // El consumo real baja en los 1.000 g que se fueron a la otra sucursal:
    // salieron de la cámara, pero no por la cocina.
    assert.equal(
      Number(carneDespues.consumo_real).toFixed(4),
      (Number(carneAntes.consumo_real) - 1000).toFixed(4),
      'la mercadería transferida salió del stock sin ser consumida',
    )
    // Y el faltante sin explicar NO crece: la transferencia está contemplada.
    assert.equal(Number(carneDespues.varianza_no_explicada), 500,
      'el desvío baja 1.000 g porque 1.000 g ahora tienen explicación')
  } finally {
    // Limpiar SIEMPRE: si este test falla a mitad, el que sigue hereda la fila.
    await sql(`delete from movimientos_manuales where fecha = '2026-02-04'`)
  }
})

test('el stock teórico parte del último conteo y descuenta el consumo', async () => {
  // Al 6 de febrero el conteo base de la carne es el de apertura (1 de
  // febrero), y desde ahí:
  //     4.000,0000  contados
  //  + 10.000,0000  comprados
  //  -    500,0000  registrados como merma
  //  -  2.972,3684  que las recetas dicen que se consumió
  //  = 10.527,6316
  const filas = await sql(`select * from stock_teorico('2026-02-06')`)
  const carne = filas.find((f) => f.insumo === 'Carne picada')

  assert.equal(carne.conteo_base.toISOString().slice(0, 10), '2026-02-01')
  assert.equal(Number(carne.dias_desde_conteo), 5)
  assert.equal(Number(carne.cantidad_contada), 4000)
  assert.equal(Number(carne.entradas), 10000)
  assert.equal(Number(carne.salidas), 500, 'la merma del escenario')
  assert.equal(Number(carne.consumo_teorico).toFixed(4), '2972.3684')
  assert.equal(
    Number(carne.stock).toFixed(4),
    (4000 + 10000 - 500 - 2972.3684).toFixed(4),
  )
  assert.equal(Number(carne.stock).toFixed(4), '10527.6316')
})

test('el stock informa siempre desde qué conteo se calculó', async () => {
  // Un stock teórico calculado sobre un conteo de hace tres meses arrastra tres
  // meses de error: mostrarlo sin la fecha le da una precisión que no tiene.
  const filas = await sql(`select * from stock_teorico('2026-03-15')`)
  assert.ok(filas.length > 0)
  for (const f of filas) {
    assert.ok(f.conteo_base, `${f.insumo} no dice desde cuándo`)
    assert.ok(Number(f.dias_desde_conteo) > 30,
      'a esta altura el conteo base ya está viejo y la pantalla lo avisa')
  }
})

test('solo entran al stock los insumos que alguna vez se contaron', async () => {
  // Asumir cero para un insumo nunca contado inventaría un faltante, igual que
  // en el informe de varianza.
  const filas = await sql(`select * from stock_teorico('2026-02-10')`)
  assert.equal(filas.length, 4, 'el conteo del escenario es parcial: cuatro insumos')
  assert.ok(!filas.some((f) => f.insumo === 'Cebolla'))
})

// ---------------------------------------------------------------------------
// Mermas
// ---------------------------------------------------------------------------

test('las mermas se miden contra el mismo denominador que el food cost', async () => {
  const [m] = await sql(`select * from resumen_mermas($1,$2)`, FEB)
  const [p] = await sql(`select * from resumen_prime_cost($1,$2)`, FEB)

  // 500 g de carne a $9/g = $4.500, sobre 427.000 de ventas costeadas.
  assert.equal(Number(m.costo_mermas).toFixed(2), '4500.00')
  assert.equal(Number(m.ventas_costeadas).toFixed(2), Number(p.ventas_costeadas).toFixed(2))
  assert.equal(Number(m.mermas_pct).toFixed(2), '1.05')
  assert.equal(Number(m.registros), 1)
  assert.deepEqual(m.por_motivo, { error_cocina: 4500 })
})

test('la merma se valúa al costo congelado, no al precio de hoy', async () => {
  // Igual que un conteo cerrado o una venta importada: un mes ya reportado no
  // cambia de números porque hoy subió un precio.
  await sql(
    `update precios_insumo set precio = precio * 3
     where insumo_id = (select id from insumos where nombre = 'Carne picada'
                        and organizacion_id = $1)`,
    [ORG],
  )
  const [m] = await sql(`select * from resumen_mermas($1,$2)`, FEB)
  assert.equal(Number(m.costo_mermas).toFixed(2), '4500.00',
    'el costo unitario quedó congelado al registrar la merma')

  await sql(
    `update precios_insumo set precio = precio / 3
     where insumo_id = (select id from insumos where nombre = 'Carne picada'
                        and organizacion_id = $1)`,
    [ORG],
  )
})
