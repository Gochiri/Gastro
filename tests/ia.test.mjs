import { strict as assert } from 'node:assert'
import { execFileSync } from 'node:child_process'
import test, { before, after } from 'node:test'

process.env.DATABASE_URL ??= 'postgresql://app_user:test@localhost:5433/gastro'

const { construirContexto } = await import('../consultas/contexto-ia.ts')
const { auditarCifras, numerosDelTexto, explicarKpis, valoresNumericos, lecturasPosibles } =
  await import('../lib/ia.ts')
const { cerrarPool } = await import('../lib/db.ts')

const USUARIO = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'

before(() => {
  execFileSync('./scripts/db.sh', ['reset'], { stdio: 'pipe' })
  execFileSync('node', ['scripts/escenario.mjs'], { stdio: 'pipe' })
})

after(async () => {
  await cerrarPool()
})

test('el contexto trae las cifras ya calculadas, incluidas las derivadas', async () => {
  const c = await construirContexto(USUARIO)
  assert.ok(c, 'debe haber contexto con el escenario cargado')

  // Las mismas cifras verificadas a mano en las fases anteriores.
  assert.equal(c.ventas.ventas_brutas, 484800)
  assert.equal(c.ventas.food_cost_pct, 20.72)
  assert.equal(c.ventas.cobertura_costeo_pct, 88.08)

  // Derivadas: el modelo no debe tener que restarlas.
  assert.equal(c.inventario.disponible, true)
  assert.equal(c.inventario.brecha_puntos, 4.21,
    'la brecha entre teórico y real viene resuelta, no se calcula en el prompt')
  assert.equal(c.inventario.sin_explicar, 13500)

  // El margen por unidad de cada canal, también resuelto.
  const rappi = c.canales.find((x) => x.canal === 'Rappi')
  assert.ok(rappi.margen_por_unidad > 0)
  assert.equal(rappi.comision_pct, 28)
})

test('un producto sin ficha técnica llega con margen null, no con cero', async () => {
  const c = await construirContexto(USUARIO)
  const cerveza = c.productos.find((p) => p.producto === 'Cerveza artesanal')
  assert.equal(cerveza.costeado, false)
  assert.equal(cerveza.margen, null,
    'con costo cero parecería el producto más rentable del negocio')
  assert.equal(cerveza.margen_pct, null)
})

test('extrae números en formato LATAM y simple', () => {
  assert.deepEqual(numerosDelTexto('El margen fue $ 359.193,29'), [359193.29])
  assert.deepEqual(numerosDelTexto('subió 4,2 puntos'), [4.2])
  assert.deepEqual(numerosDelTexto('1,234.56 y 42'), [1234.56, 42])
})

test('la guardia acepta las cifras que están en el contexto', async () => {
  const c = await construirContexto(USUARIO)
  const texto =
    'Las ventas del período fueron $484.800,00 con un food cost de 20,72 %. ' +
    'Faltan $13.500,00 sin explicación.'
  assert.deepEqual(auditarCifras(texto, c), [], 'ninguna de esas cifras es inventada')
})

test('la guardia atrapa una cifra inventada', async () => {
  const c = await construirContexto(USUARIO)
  // 999.999 no existe en ningún lado del contexto.
  const texto = 'El margen del período fue de $999.999,00.'
  const sospechosas = auditarCifras(texto, c)
  assert.deepEqual(sospechosas, [999999])
})

test('la guardia atrapa un porcentaje mal calculado', async () => {
  const c = await construirContexto(USUARIO)
  // El food cost real es 24,93 %; un modelo que "redondee" a 25,4 estaría
  // inventando, y eso es exactamente lo que hay que detectar.
  assert.deepEqual(auditarCifras('El food cost real trepó a 25,4 %.', c), [25.4])
  // Pero el valor correcto pasa.
  assert.deepEqual(auditarCifras('El food cost real fue 24,93 %.', c), [])
})

test('los conteos chicos no se marcan como inventados', async () => {
  const c = await construirContexto(USUARIO)
  assert.deepEqual(
    auditarCifras('Los 3 canales tuvieron margen positivo en los 8 días.', c),
    [],
    'enteros hasta 12 son conteos, no afirmaciones sobre el negocio',
  )
})

test('el flujo completo audita la respuesta y calcula el costo', async () => {
  const c = await construirContexto(USUARIO)

  // Invocador simulado: no hace falta API para probar la lógica que importa.
  const inventor = async () => ({
    respuesta: {
      respuesta: 'Las ventas fueron $484.800,00 y el margen $7.777.777,00.',
      hallazgos: [
        { titulo: 'Food cost al 20,72 %', detalle: 'Dentro de lo esperable.', severidad: 'informativo' },
      ],
      recomendaciones: [],
      datos_insuficientes: false,
    },
    tokensEntrada: 12000,
    tokensSalida: 800,
    tokensCacheLectura: 10000,
    modelo: 'claude-opus-5',
  })

  const r = await explicarKpis(c, '¿cómo vengo?', { invocador: inventor })

  assert.deepEqual(r.cifrasNoRespaldadas, [7777777],
    'la cifra inventada se detecta aunque el resto de la respuesta sea correcta')
  // 12000 entrada x $5/M + 800 salida x $25/M
  assert.equal(r.costoUsd, 0.08)
  assert.ok(r.duracionMs >= 0)
})

test('valoresNumericos aplana todo el contexto', async () => {
  const c = await construirContexto(USUARIO)
  const valores = valoresNumericos(c)
  assert.ok(valores.has(484800), 'debe incluir las ventas')
  assert.ok(valores.has(13500), 'y las cifras anidadas del inventario')
  assert.ok(valores.size > 50, `esperaba muchos valores, hubo ${valores.size}`)
})

test('la puntuación final de la oración no altera el número', () => {
  // "$999.999,00." con el punto de cierre: si entra en la coincidencia, el
  // parser podría leer 999,999 en vez de 999.999.
  assert.deepEqual(numerosDelTexto('fue $999.999,00.'), [999999])
  assert.deepEqual(numerosDelTexto('subió a 20,72 %.'), [20.72])
  assert.deepEqual(numerosDelTexto('son 1.500 g,'), [1500])
})

test('las dos lecturas de un número ambiguo se consideran', () => {
  // "1.500" es mil quinientos o uno coma cinco: sin contexto no se puede saber.
  assert.deepEqual(lecturasPosibles('1.500').sort((a, b) => a - b), [1.5, 1500])
  // Con dos separadores no hay ambigüedad.
  assert.deepEqual(lecturasPosibles('1.234,56'), [1234.56])
  assert.deepEqual(lecturasPosibles('1,234.56'), [1234.56])
  // "20,72" no puede ser agrupación de miles: solo dos dígitos después.
  assert.deepEqual(lecturasPosibles('20,72'), [20.72])
})

test('un número ambiguo no se acusa si alguna lectura está en el contexto', async () => {
  const c = await construirContexto(USUARIO)
  // 1.500 g de carne sin explicar SÍ está en el contexto (como 1500).
  assert.deepEqual(
    auditarCifras('Faltan 1.500 g de carne sin explicación.', c),
    [],
    'acusar una cifra correcta enseña a ignorar la advertencia',
  )
})

test('el auditor sigue atrapando lo inventado aunque sea ambiguo', async () => {
  const c = await construirContexto(USUARIO)
  // Ninguna lectura de "8.888" (8888 ni 8.888) está en el contexto.
  assert.deepEqual(auditarCifras('Se perdieron 8.888 g.', c), [8888])
})
