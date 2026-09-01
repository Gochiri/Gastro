import { strict as assert } from 'node:assert'
import { execFileSync } from 'node:child_process'
import test, { before, after } from 'node:test'
import pg from 'pg'

process.env.DATABASE_URL ??= 'postgresql://app_user:test@localhost:5433/gastro'

const admin = new pg.Pool({ connectionString: 'postgresql://postgres@localhost:5433/gastro' })
const sql = async (t, p = []) => (await admin.query(t, p)).rows

const ORG = '11111111-1111-1111-1111-111111111111'
const CASA_CENTRAL = '11111111-0000-0000-0000-000000000001'
const PALERMO = '11111111-0000-0000-0000-000000000002'

/**
 * Estructura de costos del seed, en pesos por mes. Se repite acá a propósito:
 * si el seed cambia, estos tests tienen que fallar y obligar a recalcular, no
 * adaptarse solos leyendo la misma tabla que están verificando.
 */
const ESTRUCTURA = [
  ['alquiler Casa Central',   850000, true,  true],
  ['alquiler Palermo',        620000, true,  true],
  ['servicios',               180000, true,  true],
  ['administración',          320000, true,  true],
  ['marketing',                90000, true,  true],
  ['seguros',                  45000, true,  true],
  ['mantenimiento',            60000, true,  true],
  ['impuestos municipales',    75000, true,  true],
  ['préstamo (financiero)',   140000, false, true],  // fuera del EBITDA, sí es caja
  ['amortización',            110000, false, false], // fuera del EBITDA y no es caja
]

const MENSUAL_TOTAL      = ESTRUCTURA.reduce((s, [, v]) => s + v, 0)              // 2.490.000
const MENSUAL_EN_EBITDA  = ESTRUCTURA.filter((g) => g[2]).reduce((s, g) => s + g[1], 0) // 2.240.000
const MENSUAL_DE_CAJA    = ESTRUCTURA.filter((g) => g[3]).reduce((s, g) => s + g[1], 0) // 2.380.000

before(() => {
  execFileSync('./scripts/db.sh', ['reset'], { stdio: 'pipe' })
  execFileSync('node', ['scripts/escenario.mjs'], { stdio: 'pipe' })
})

after(async () => {
  await admin.end()
})

// ---------------------------------------------------------------------------
// Devengamiento
// ---------------------------------------------------------------------------

test('la estructura del seed es la que dicen estos tests', async () => {
  const [r] = await sql(
    `select sum(importe_mensual) as total,
            sum(importe_mensual) filter (where app_gasto_en_ebitda(categoria)) as ebitda,
            sum(importe_mensual) filter (where app_gasto_es_caja(categoria))   as caja
     from gastos_fijos where organizacion_id = $1`,
    [ORG],
  )
  assert.equal(Number(r.total), MENSUAL_TOTAL, '2.490.000 por mes de estructura')
  assert.equal(Number(r.ebitda), MENSUAL_EN_EBITDA)
  assert.equal(Number(r.caja), MENSUAL_DE_CAJA)
})

test('siete días de febrero devengan exactamente un cuarto del mes', async () => {
  // Febrero de 2026 tiene 28 días: del 1 al 7 son 7, o sea 7/28 = 0,25 justo.
  const [r] = await sql(`select * from resumen_gastos_fijos('2026-02-01','2026-02-07')`)
  assert.equal(Number(r.total).toFixed(2), (MENSUAL_TOTAL / 4).toFixed(2))
  assert.equal(Number(r.en_ebitda).toFixed(2), (MENSUAL_EN_EBITDA / 4).toFixed(2))
  assert.equal(Number(r.de_caja).toFixed(2), (MENSUAL_DE_CAJA / 4).toFixed(2))
  // Alquileres de los dos locales: 1.470.000 al mes, 367.500 en la semana.
  assert.equal(Number(r.asignados).toFixed(2), '367500.00')
  assert.equal(Number(r.sin_asignar).toFixed(2), '255000.00')
})

test('un período a caballo de dos meses prorratea cada mes por sus propios días', async () => {
  // Del 15 de enero al 14 de febrero: 17 días de un enero de 31 y 14 de un
  // febrero de 28. Prorratear sobre "un mes de 30" daría otro número.
  const esperado = ESTRUCTURA.reduce(
    (suma, [, mensual]) =>
      suma + Math.round((mensual * (17 / 31) + mensual * (14 / 28)) * 100) / 100,
    0,
  )
  const [r] = await sql(`select * from resumen_gastos_fijos('2026-01-15','2026-02-14')`)
  assert.equal(Number(r.total).toFixed(2), esperado.toFixed(2))
  // Y no coincide con el atajo de 30 días por mes, que es el error que se
  // quiere evitar.
  const atajo = MENSUAL_TOTAL * (31 / 30)
  assert.ok(Math.abs(Number(r.total) - atajo) > 1000)
})

test('un gasto solo devenga dentro de su vigencia', async () => {
  const [antes] = await sql(`select * from resumen_gastos_fijos('2025-12-01','2025-12-31')`)
  assert.equal(Number(antes.total), 0, 'la estructura arranca el 1 de enero de 2026')

  // Se da de baja el alquiler de Palermo a mitad de febrero.
  await sql(
    `update gastos_fijos set vigente_hasta = '2026-02-14'
     where concepto = 'Alquiler Sucursal Palermo'`,
  )
  const [r] = await sql(`select * from resumen_gastos_fijos('2026-02-01','2026-02-28')`)
  // Febrero completo: todo menos Palermo, más Palermo por 14 de 28 días.
  const esperado = MENSUAL_TOTAL - 620000 + 620000 / 2
  assert.equal(Number(r.total).toFixed(2), esperado.toFixed(2))

  await sql(`update gastos_fijos set vigente_hasta = null
             where concepto = 'Alquiler Sucursal Palermo'`)
})

// ---------------------------------------------------------------------------
// EBITDA
// ---------------------------------------------------------------------------

test('el EBITDA coincide con el cálculo hecho a mano', async () => {
  // Ventas 484.800 − comisiones 37.139 − materia prima 88.467,71
  //   − trabajo 229.500 = margen de contribución 129.693,29
  // menos 2.240.000 de estructura operativa del mes = −2.110.306,71
  const [r] = await sql(`select * from resumen_ebitda('2026-02-01','2026-02-28')`)
  assert.equal(Number(r.ventas_netas).toFixed(2), '484800.00')
  assert.equal(Number(r.comisiones).toFixed(2), '37139.00')
  assert.equal(Number(r.costo_materia_prima).toFixed(2), '88467.71')
  assert.equal(Number(r.costo_laboral).toFixed(2), '229500.00')
  assert.equal(Number(r.margen_contribucion).toFixed(2), '129693.29')
  assert.equal(Number(r.gastos_fijos).toFixed(2), MENSUAL_EN_EBITDA.toFixed(2))
  assert.equal(Number(r.ebitda).toFixed(2), '-2110306.71')
  // Intereses y amortización quedan afuera del EBITDA pero se pagan igual.
  assert.equal(Number(r.gastos_fuera_ebitda).toFixed(2), '250000.00')
  assert.equal(Number(r.resultado).toFixed(2), '-2360306.71')
})

test('el EBITDA se calcula sobre las ventas totales, no sobre las costeadas', async () => {
  // Es la única métrica del sistema que NO usa el denominador de ventas
  // costeadas: el resultado del negocio incluye las cervezas sin ficha.
  const [e] = await sql(`select * from resumen_ebitda('2026-02-01','2026-02-28')`)
  const [p] = await sql(`select * from resumen_prime_cost('2026-02-01','2026-02-28')`)
  assert.equal(Number(e.ventas_netas).toFixed(2), '484800.00')
  assert.equal(Number(p.ventas_costeadas).toFixed(2), '427000.00')
  assert.notEqual(Number(e.ventas_netas), Number(p.ventas_costeadas))
})

test('el EBITDA avisa que es un techo cuando hay ventas sin costear', async () => {
  const [r] = await sql(`select * from resumen_ebitda('2026-02-01','2026-02-28')`)
  // 484.800 − 427.000 de ventas costeadas = 57.800 sin costo conocido.
  assert.equal(Number(r.ventas_sin_costear).toFixed(2), '57800.00')
  assert.equal(Number(r.cobertura_costeo_pct).toFixed(2), '88.08')
  assert.equal(Number(r.fichajes_abiertos), 1, 'el turno sin cerrar se informa')
})

// ---------------------------------------------------------------------------
// Punto de equilibrio
// ---------------------------------------------------------------------------

test('el punto de equilibrio sale del cociente exacto, no del porcentaje redondeado', async () => {
  const [r] = await sql(`select * from punto_equilibrio('2026-02-01','2026-02-28')`)

  const gastosCaja = MENSUAL_DE_CAJA // 2.380.000, el mes completo
  const mc = 129693.29
  const ventas = 484800
  const exacto = (gastosCaja * ventas) / mc

  assert.equal(Number(r.gastos_fijos_caja).toFixed(2), gastosCaja.toFixed(2))
  assert.equal(Number(r.ventas_equilibrio).toFixed(2), exacto.toFixed(2))
  assert.equal(Number(r.ventas_equilibrio).toFixed(2), '8896558.95')

  // El atajo de dividir por el margen de contribución ya redondeado a dos
  // decimales (26,75 %) se desvía en más de cien pesos. Parece poco hasta que
  // alguien planifica una campaña con ese número.
  const conPorcentajeRedondeado = gastosCaja / (Math.round((100 * mc) / ventas * 100) / 10000)
  assert.ok(
    Math.abs(conPorcentajeRedondeado - Number(r.ventas_equilibrio)) > 100,
    'el redondeo intermedio se nota',
  )

  assert.equal(r.alcanzado, false)
  assert.equal(Number(r.dias), 28)
  assert.equal(
    Number(r.venta_diaria_equilibrio).toFixed(2),
    (exacto / 28).toFixed(2),
  )
})

test('la amortización queda fuera del punto de equilibrio pero dentro del resultado', async () => {
  const [pe] = await sql(`select * from punto_equilibrio('2026-02-01','2026-02-28')`)
  const [g]  = await sql(`select * from resumen_gastos_fijos('2026-02-01','2026-02-28')`)
  assert.equal(
    Number(g.total) - Number(pe.gastos_fijos_caja),
    110000,
    'la amortización no es una factura que haya que pagar este mes',
  )
})

test('sin margen de contribución positivo no hay punto de equilibrio', async () => {
  // Un mes con personal y sin ventas: cada peso de estructura es pérdida y
  // ningún volumen de ventas lo arregla, porque no hay ventas.
  await sql(
    `insert into fichajes (organizacion_id, sucursal_id, empleado_id, entrada, salida,
                           costo_hora_aplicado, cargas_pct_aplicado)
     select $1, $2, e.id, '2026-04-06T10:00:00-03:00', '2026-04-06T18:00:00-03:00',
            e.costo_hora, e.cargas_sociales_pct
     from empleados e where e.organizacion_id = $1 limit 1`,
    [ORG, CASA_CENTRAL],
  )
  const [r] = await sql(`select * from punto_equilibrio('2026-04-01','2026-04-30')`)
  assert.ok(Number(r.margen_contribucion) < 0, 'trabajo pagado sin nada vendido')
  assert.equal(r.ventas_equilibrio, null, 'un número inventado acá sería peor que un guion')
  assert.equal(r.brecha, null)

  await sql(`delete from fichajes where entrada >= '2026-04-01'`)
})

// ---------------------------------------------------------------------------
// IVA y retenciones
// ---------------------------------------------------------------------------

test('el IVA de ventas se despeja del precio final, no se suma encima', async () => {
  const [r] = await sql(
    `select * from reporte_iva('2026-02-01','2026-02-28') where tasa = 21`,
  )
  // 484.800 son precios al público con IVA incluido: la base se despeja hacia
  // atrás. Tratarlos como netos declararía 101.808 de débito.
  const base = 484800 / 1.21
  assert.equal(Number(r.ventas_base).toFixed(2), base.toFixed(2))
  assert.equal(Number(r.iva_debito).toFixed(2), (Math.round(base * 100) / 100 * 0.21).toFixed(2))
  assert.equal(Number(r.iva_debito).toFixed(2), '84138.84')
  assert.notEqual(Number(r.iva_debito).toFixed(2), (484800 * 0.21).toFixed(2))
})

test('los alimentos frescos generan crédito a la alícuota reducida', async () => {
  const filas = await sql(`select * from reporte_iva('2026-02-01','2026-02-28') order by tasa`)
  const reducida = filas.find((f) => Number(f.tasa) === 10.5)
  const general = filas.find((f) => Number(f.tasa) === 21)

  assert.ok(reducida, 'carne, queso y verdura se compran al 10,5 %')
  assert.equal(Number(reducida.ventas_base).toFixed(2), '0.00',
    'el plato terminado se vende al 21 %, no al 10,5 %')
  assert.ok(Number(reducida.iva_credito) > 0)

  // El crédito total tiene que ser el de las dos alícuotas.
  const [r] = await sql(`select * from resumen_fiscal('2026-02-01','2026-02-28')`)
  assert.equal(
    Number(r.iva_credito).toFixed(2),
    (Number(reducida.iva_credito) + Number(general.iva_credito)).toFixed(2),
  )
})

test('las retenciones sufridas descuentan de la posición del período', async () => {
  const [r] = await sql(`select * from resumen_fiscal('2026-02-01','2026-02-28')`)
  assert.equal(Number(r.retenciones_iva).toFixed(2), '3600.00')
  assert.equal(
    Number(r.iva_a_pagar).toFixed(2),
    (Number(r.iva_posicion) - 3600).toFixed(2),
  )
  // Ingresos Brutos: 3 % sobre la base neta de IVA, menos lo ya retenido.
  assert.equal(Number(r.ingresos_brutos_pct), 3)
  assert.equal(
    Number(r.ingresos_brutos).toFixed(2),
    (Math.round((484800 / 1.21) * 100) / 100 * 0.03).toFixed(2),
  )
  assert.equal(Number(r.retenciones_ib).toFixed(2), '2400.00')
  assert.equal(
    Number(r.ib_a_pagar).toFixed(2),
    (Number(r.ingresos_brutos) - 2400).toFixed(2),
  )
  // Ganancias es pago a cuenta del impuesto anual: se informa, no se resta.
  assert.equal(Number(r.retenciones_ganancias).toFixed(2), '1600.00')
  assert.equal(
    Number(r.total_estimado).toFixed(2),
    (Number(r.iva_a_pagar) + Number(r.ib_a_pagar)).toFixed(2),
  )
})

test('una retención mayor a la posición no produce un saldo negativo a pagar', async () => {
  await sql(
    `insert into retenciones (organizacion_id, fecha, tipo, sentido, contraparte, importe)
     values ($1, '2026-02-04', 'iva', 'sufrida', 'Retención excesiva', 500000)`,
    [ORG],
  )
  const [r] = await sql(`select * from resumen_fiscal('2026-02-01','2026-02-28')`)
  assert.ok(Number(r.iva_posicion) > 0)
  assert.equal(Number(r.iva_a_pagar).toFixed(2), '0.00',
    'un saldo a favor no es "pagar menos que cero": se arrastra')

  await sql(`delete from retenciones where contraparte = 'Retención excesiva'`)
})

// ---------------------------------------------------------------------------
// Comparativo entre sucursales
// ---------------------------------------------------------------------------

test('una sucursal sin ventas no recibe prorrateo pero carga sus gastos propios', async () => {
  const filas = await sql(`select * from comparativo_sucursales('2026-02-01','2026-02-28')`)
  const palermo = filas.find((f) => f.sucursal === 'Sucursal Palermo')

  assert.ok(palermo, 'una sucursal con gastos aparece aunque no haya vendido')
  assert.equal(Number(palermo.ventas).toFixed(2), '0.00')
  assert.equal(Number(palermo.gastos_prorrateados).toFixed(2), '0.00')
  assert.equal(Number(palermo.gastos_asignados).toFixed(2), (620000).toFixed(2))
  assert.equal(Number(palermo.ebitda).toFixed(2), (-620000).toFixed(2))
  assert.equal(palermo.food_cost_pct, null, 'sin ventas costeadas no hay porcentaje que informar')
})

test('la suma de los EBITDA por sucursal es el EBITDA de la organización', async () => {
  const filas = await sql(`select * from comparativo_sucursales('2026-02-01','2026-02-28')`)
  const [org] = await sql(`select * from resumen_ebitda('2026-02-01','2026-02-28')`)
  const suma = filas.reduce((s, f) => s + Number(f.ebitda), 0)
  assert.equal(suma.toFixed(2), Number(org.ebitda).toFixed(2))
})

test('con dos sucursales vendiendo, el prorrateo sigue la participación en las ventas', async () => {
  // Se le da vida a Palermo copiando cuatro ventas a esa sucursal. Es dato
  // creado por este test: el escenario compartido no se toca, para que los
  // números verificados a mano en las otras suites sigan valiendo.
  await sql(
    `insert into ventas (organizacion_id, sucursal_id, fecha, canal_id, producto_id,
                         cantidad, importe_bruto, descuento, comision_pct_aplicada,
                         costo_unitario_teorico, costeada_en)
     select organizacion_id, $2, fecha, canal_id, producto_id, cantidad, importe_bruto,
            descuento, comision_pct_aplicada, costo_unitario_teorico, costeada_en
     from ventas where sucursal_id = $1 order by fecha limit 4`,
    [CASA_CENTRAL, PALERMO],
  )

  const filas = await sql(`select * from comparativo_sucursales('2026-02-01','2026-02-28')`)
  const [org] = await sql(`select * from resumen_ebitda('2026-02-01','2026-02-28')`)
  const casa = filas.find((f) => f.sucursal === 'Casa Central')
  const palermo = filas.find((f) => f.sucursal === 'Sucursal Palermo')

  assert.ok(Number(palermo.ventas) > 0)
  const totalVentas = Number(casa.ventas) + Number(palermo.ventas)
  assert.equal(Number(totalVentas).toFixed(2), Number(org.ventas_netas).toFixed(2))

  // Participación = ventas propias / ventas de la organización.
  assert.equal(
    Number(palermo.participacion_pct).toFixed(2),
    ((100 * Number(palermo.ventas)) / totalVentas).toFixed(2),
  )
  // Y el prorrateo la sigue. Lo repartible son los gastos de organización que
  // ENTRAN en el EBITDA: 770.000 al mes (servicios, administración, marketing,
  // seguros, mantenimiento e impuestos municipales). El préstamo y la
  // amortización también son de organización, pero quedan fuera del EBITDA y
  // por lo tanto fuera del reparto.
  const aRepartir = 770000
  assert.ok(
    Math.abs(Number(palermo.gastos_prorrateados) - aRepartir * (Number(palermo.ventas) / totalVentas)) < 0.01,
  )
  assert.equal(
    (Number(casa.gastos_prorrateados) + Number(palermo.gastos_prorrateados)).toFixed(2),
    aRepartir.toFixed(2),
    'lo repartido tiene que ser exactamente lo que había para repartir',
  )

  // El invariante se mantiene con dos sucursales activas. Se admite un centavo
  // de tolerancia: cada fila redondea su prorrateo por separado.
  const suma = filas.reduce((s, f) => s + Number(f.ebitda), 0)
  assert.ok(Math.abs(suma - Number(org.ebitda)) <= 0.01, `suma ${suma} vs ${org.ebitda}`)

  await sql(`delete from ventas where sucursal_id = $1`, [PALERMO])
})

test('el food cost por sucursal usa el mismo denominador que el resto del sistema', async () => {
  const filas = await sql(`select * from comparativo_sucursales('2026-02-01','2026-02-28')`)
  const casa = filas.find((f) => f.sucursal === 'Casa Central')
  const [p] = await sql(`select * from resumen_prime_cost('2026-02-01','2026-02-28')`)

  // Con toda la venta en Casa Central, su food cost tiene que ser idéntico al
  // del dashboard. Si difiere, hay dos denominadores dando vueltas.
  assert.equal(Number(casa.food_cost_pct).toFixed(2), Number(p.food_cost_pct).toFixed(2))
  assert.equal(Number(casa.prime_cost_pct).toFixed(2), Number(p.prime_cost_pct).toFixed(2))
  assert.equal(Number(casa.ventas_costeadas).toFixed(2), Number(p.ventas_costeadas).toFixed(2))
})

// ---------------------------------------------------------------------------
// El período del cierre
// ---------------------------------------------------------------------------

test('el cierre financiero abarca el mes calendario, no los días con ventas', async () => {
  // Las ventas del escenario van del 5 al 7 de febrero, pero las compras son
  // del día 3. Recortar el período a los días con ventas dejaba el crédito
  // fiscal de esas compras afuera y hacía pagar IVA de más.
  const { periodoFinanciero, coberturaCalendario, resumenFiscal } =
    await import('../consultas/finanzas.ts')
  const { cerrarPool } = await import('../lib/db.ts')
  const USUARIO = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'

  try {
    const periodo = await periodoFinanciero(USUARIO)
    assert.deepEqual(periodo, { desde: '2026-02-01', hasta: '2026-02-28' })

    const cal = await coberturaCalendario(USUARIO, periodo)
    assert.equal(cal.dias, 28)
    assert.equal(cal.diasConVentas, 3, 'el desfase se informa en vez de recortar el mes')
    assert.equal(cal.primeraVenta, '2026-02-05')
    assert.equal(cal.ultimaVenta, '2026-02-07')

    const fiscal = await resumenFiscal(USUARIO, periodo)
    assert.ok(fiscal.ivaCredito > 0, 'las compras del día 3 están dentro del mes')
    assert.equal(fiscal.ivaAPagar.toFixed(2), '64537.34')
  } finally {
    await cerrarPool()
  }
})
