import { strict as assert } from 'node:assert'
import { execFileSync } from 'node:child_process'
import test, { before, after } from 'node:test'
import pg from 'pg'

process.env.DATABASE_URL ??= 'postgresql://app_user:test@localhost:5433/gastro'

const admin = new pg.Pool({ connectionString: 'postgresql://postgres@localhost:5433/gastro' })
const sql = async (t, p = []) => (await admin.query(t, p)).rows

const {
  matrizMenu,
  coberturaMatriz,
  anomalias,
  contextoMenu,
  contextoRrss,
  contextoEscandallo,
  emparejarIngredientes,
  SIMILITUD_PARA_PRESELECCION,
} = await import('../consultas/widgets.ts')
const { ejecutarWidget, auditarCifras } = await import('../lib/ia.ts')
const { WIDGET_MENU } = await import('../lib/widgets/menu.ts')
const { WIDGET_ANOMALIAS } = await import('../lib/widgets/anomalias.ts')
const { WIDGET_RRSS } = await import('../lib/widgets/rrss.ts')
const { WIDGET_ESCANDALLO } = await import('../lib/widgets/escandallo.ts')
const { cerrarPool } = await import('../lib/db.ts')

const USUARIO = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const FEBRERO = { desde: '2026-02-01', hasta: '2026-02-28' }

before(() => {
  execFileSync('./scripts/db.sh', ['reset'], { stdio: 'pipe' })
  execFileSync('node', ['scripts/escenario.mjs'], { stdio: 'pipe' })
})

after(async () => {
  await admin.end()
  await cerrarPool()
})

// ---------------------------------------------------------------------------
// Matriz de menu engineering
// ---------------------------------------------------------------------------

test('la matriz clasifica los cuatro platos contra el cálculo hecho a mano', async () => {
  const matriz = await matrizMenu(USUARIO, FEBRERO)
  const por = Object.fromEntries(matriz.map((f) => [f.producto, f]))

  // Umbral de popularidad: 0,70 / 4 platos = 17,50 %.
  assert.equal(matriz[0].umbralPopularidadPct, 17.5)

  // Margen de referencia: margen total costeado / unidades costeadas,
  // PONDERADO, no el promedio de los márgenes unitarios.
  const totalUnidades = matriz.reduce((s, f) => s + f.unidades, 0)
  const totalMargen = matriz.reduce((s, f) => s + f.margen, 0)
  assert.equal(totalUnidades, 52)
  assert.equal(
    matriz[0].margenReferencia.toFixed(2),
    (totalMargen / totalUnidades).toFixed(2),
  )
  assert.equal(matriz[0].margenReferencia, 5918.79)

  // Lasaña: 16 de 52 unidades = 30,77 % (> 17,50) y 10.625,07 de margen
  // unitario (> 5.918,79). Popular y rentable.
  assert.equal(por['Lasaña'].popularidadPct, 30.77)
  assert.equal(por['Lasaña'].margenUnitario, 10625.07)
  assert.equal(por['Lasaña'].clasificacion, 'estrella')

  // Papas fritas: se venden más que nada (34,62 %) y dejan 2.164,76.
  assert.equal(por['Papas fritas'].clasificacion, 'vaca')

  // Pizza Margarita: 13,46 % de las unidades y margen por debajo de la
  // referencia. Es el único perro.
  assert.equal(por['Pizza Margarita'].clasificacion, 'perro')
  assert.equal(
    matriz.filter((f) => f.clasificacion === 'perro').length,
    1,
  )
})

test('un plato al borde del umbral queda expuesto, no escondido', async () => {
  const matriz = await matrizMenu(USUARIO, FEBRERO)
  const hamburguesa = matriz.find((f) => f.producto === 'Hamburguesa clásica')

  // 5.851,84 contra una referencia de 5.918,79: la casilla se define por 67
  // pesos. La distancia se informa para que nadie lea eso como un veredicto.
  assert.equal(hamburguesa.clasificacion, 'vaca')
  assert.equal(hamburguesa.distanciaMargen, -66.96)
  assert.ok(
    Math.abs(hamburguesa.distanciaMargen) < hamburguesa.margenReferencia * 0.1,
    'está a menos del 10% del umbral: es un caso de borde',
  )
})

test('los productos sin ficha técnica no entran ni al numerador ni al denominador', async () => {
  const [matriz, cobertura] = await Promise.all([
    matrizMenu(USUARIO, FEBRERO),
    coberturaMatriz(USUARIO, FEBRERO),
  ])

  assert.ok(
    !matriz.some((f) => f.producto === 'Cerveza artesanal'),
    'con margen cero sería clasificada como perro y llevaría a retirarla',
  )
  // Y sus 16 unidades tampoco cuentan para la popularidad de los demás: el
  // total clasificado es 52, no 68.
  assert.equal(matriz.reduce((s, f) => s + f.unidades, 0), 52)
  assert.equal(cobertura.unidadesSinFicha, 16)
  assert.equal(cobertura.productosSinFicha, 1)
  assert.equal(cobertura.coberturaPct, 88.08)
})

test('la popularidad suma 100% entre los platos clasificados', async () => {
  const matriz = await matrizMenu(USUARIO, FEBRERO)
  const suma = matriz.reduce((s, f) => s + (f.popularidadPct ?? 0), 0)
  assert.ok(Math.abs(suma - 100) < 0.05, `sumó ${suma}`)
})

// ---------------------------------------------------------------------------
// Detección de anomalías
// ---------------------------------------------------------------------------

test('la detección encuentra las señales plantadas en el escenario', async () => {
  const senales = await anomalias(USUARIO, FEBRERO)
  const por = Object.fromEntries(senales.map((s) => [s.tipo, s]))

  // El faltante de carne de la fase 3: 1.500 g sin explicar = $13.500.
  assert.equal(por.varianza_insumo.entidad, 'Carne picada')
  assert.equal(por.varianza_insumo.impactoDinero, 13500)
  assert.equal(por.varianza_insumo.severidad, 'urgente')
  // 1.500 sobre un consumo teórico de 3.663,16 g.
  assert.equal(por.varianza_insumo.desvioPct, 40.95)

  // La suba de precio del tomate, que rige recién en marzo.
  assert.equal(por.precio_futuro.entidad, 'Tomate perita')
  assert.equal(por.precio_futuro.desvioPct, 37.5)

  // La hamburguesa por Rappi: 3.700,93 contra 7.080,93 en salón.
  assert.equal(por.margen_canal.entidad, 'Hamburguesa clásica por Rappi')
  assert.equal(por.margen_canal.impactoDinero, 13520)
  assert.equal(por.margen_canal.desvioPct, 52.27)

  assert.equal(por.cobertura_costeo.impactoDinero, 57800)
  assert.ok(por.fichaje_abierto, 'el turno sin cerrar del escenario')
})

test('las señales vienen ordenadas por dinero, no por porcentaje', async () => {
  const senales = await anomalias(USUARIO, FEBRERO)
  const conImpacto = senales.filter((s) => s.impactoDinero !== null)
  const ordenado = [...conImpacto].sort((a, b) => b.impactoDinero - a.impactoDinero)
  assert.deepEqual(
    conImpacto.map((s) => s.tipo),
    ordenado.map((s) => s.tipo),
  )
  // El tomate se desvía 37,5% y queda último: son $793 contra $13.500.
  assert.equal(conImpacto.at(-1).tipo, 'precio_futuro')
})

test('cada señal informa el umbral contra el que se midió', async () => {
  const senales = await anomalias(USUARIO, FEBRERO)
  const conUmbral = senales.filter((s) => s.desvioPct !== null)
  assert.ok(conUmbral.length > 0)
  for (const s of conUmbral) {
    assert.ok(s.umbral !== null, `${s.tipo} no dice contra qué se midió`)
  }
})

test('sin faltante plantado, la varianza no dispara una señal', async () => {
  // Se registra el faltante como merma: pasa a estar explicado y la regla
  // deja de disparar. Es la prueba de que la señal mide lo NO explicado.
  const [{ id: insumoId }] = await sql(
    `select id from insumos where nombre = 'Carne picada'
       and organizacion_id = '11111111-1111-1111-1111-111111111111'`,
  )
  await sql(
    `insert into mermas (organizacion_id, insumo_id, fecha, cantidad, unidad_id, motivo, costo_unitario)
     select organizacion_id, id, '2026-02-06', 1500, unidad_base_id, 'error_cocina', 9
     from insumos where id = $1`,
    [insumoId],
  )

  const senales = await anomalias(USUARIO, FEBRERO)
  assert.ok(
    !senales.some((s) => s.tipo === 'varianza_insumo' && s.entidad === 'Carne picada'),
    'explicado el faltante, la alerta se apaga',
  )

  await sql(`delete from mermas where fecha = '2026-02-06' and cantidad = 1500`)
})

// ---------------------------------------------------------------------------
// Contextos
// ---------------------------------------------------------------------------

test('el contexto del menú lleva el método, no solo los números', async () => {
  const c = await contextoMenu(USUARIO, FEBRERO)
  assert.equal(c.metodo.nombre, 'Kasavana-Smith')
  assert.match(c.metodo.eje_margen, /POR UNIDAD/)
  assert.equal(c.matriz.length, 4)
  assert.equal(c.cobertura.coberturaPct, 88.08)
})

test('el contexto de redes no incluye costos internos', async () => {
  const c = await contextoRrss(USUARIO, FEBRERO)
  const serializado = JSON.stringify(c)
  assert.ok(!serializado.includes('costo'), 'un costo interno no va a una red social')
  assert.ok(c.platos.every((p) => p.precio_promedio > 0))
  assert.ok(c.platos.every((p) => p.clasificacion))
})

// ---------------------------------------------------------------------------
// Guardias de cada widget, con invocador simulado
// ---------------------------------------------------------------------------

const invocadorQue = (respuesta) => async () => ({
  respuesta,
  tokensEntrada: 20000,
  tokensSalida: 1500,
  tokensCacheLectura: 18000,
  modelo: 'claude-opus-5',
})

test('el analista de menú detecta un margen inventado', async () => {
  const contexto = await contextoMenu(USUARIO, FEBRERO)
  const r = await ejecutarWidget(
    WIDGET_MENU,
    contexto,
    'analizá',
    {
      invocador: invocadorQue({
        lectura: 'La Lasaña deja 10.625,07 por unidad y sostiene la carta.',
        platos: [
          {
            producto: 'Pizza Margarita',
            clasificacion: 'perro',
            accion: 'retirar',
            por_que: 'Solo deja 4.920,04 por unidad y se vende poco.',
            // 88.888 no está en ningún lado del contexto.
            riesgo: 'Perdés los 88.888 que aporta al volumen.',
          },
        ],
        orden_de_ataque: ['Pizza Margarita'],
        datos_insuficientes: false,
      }),
    },
  )
  assert.deepEqual(r.cifrasNoRespaldadas, [88888])
  // 20.000 entrada x $5/M + 1.500 salida x $25/M = 0,1375
  assert.equal(r.costoUsd, 0.1375)
})

test('el detector de anomalías audita también las causas y el cómo confirmar', async () => {
  const { contextoAnomalias } = await import('../consultas/widgets.ts')
  const contexto = await contextoAnomalias(USUARIO, FEBRERO)
  const r = await ejecutarWidget(WIDGET_ANOMALIAS, contexto, 'priorizá', {
    invocador: invocadorQue({
      resumen: 'Faltan 1.500 g de carne sin explicación.',
      senales: [
        {
          entidad: 'Carne picada',
          severidad: 'urgente',
          que_pasa: 'Son $13.500 que no aparecen.',
          causas_probables: ['Porciones más grandes que la ficha'],
          que_hacer: 'Pesar tres porciones en el turno de la noche.',
          // 7.777 inventado, escondido en el campo menos obvio.
          como_confirmar: 'Comparar contra los 7.777 g del mes pasado.',
        },
      ],
      falsos_positivos: [],
      datos_insuficientes: false,
    }),
  })
  assert.deepEqual(r.cifrasNoRespaldadas, [7777],
    'la guardia cubre todos los campos de texto, no solo el resumen')
})

test('el widget de redes atrapa un precio inventado en el copy', async () => {
  const contexto = await contextoRrss(USUARIO, FEBRERO)
  const r = await ejecutarWidget(WIDGET_RRSS, contexto, 'armá el plan', {
    invocador: invocadorQue({
      estrategia: 'Empujar la Pizza Margarita, que deja 4.920,04 por unidad.',
      pilares: ['Detrás de escena', 'Producto', 'Comunidad'],
      publicaciones: [
        {
          dia: 'Jueves',
          formato: 'reel',
          pilar: 'Producto',
          producto: 'Pizza Margarita',
          titulo: 'La margarita que se hace en casa',
          hook: '¿Sabés cuánto tarda una masa de verdad?',
          // "48 horas" es una afirmación sobre el producto que el sistema no
          // puede respaldar, igual que el precio inventado de abajo.
          desarrollo: ['48 horas de fermentación'],
          // $9.999 no es el precio del contexto.
          cta: 'Reservá tu mesa y llevátela por $9.999',
          hashtags: ['#pizza', '#buenosaires'],
        },
      ],
      promocion_propuesta: null,
      datos_insuficientes: false,
    }),
  })
  // Las DOS se marcan, y está bien que así sea. En un widget analítico una
  // cifra sin respaldo es un error de cálculo; en una pieza de redes es algo
  // que el negocio va a publicar bajo su propio nombre. Que el sistema no
  // pueda respaldar "48 horas de fermentación" no la vuelve falsa, la vuelve
  // verificable, y el aviso de esta pantalla lo dice con esas palabras.
  assert.deepEqual(r.cifrasNoRespaldadas, [48, 9999],
    'toda cifra que el sistema no pueda respaldar hay que verificarla antes de publicarla')
})

test('los hashtags no disparan la guardia', async () => {
  const contexto = await contextoRrss(USUARIO, FEBRERO)
  const r = await ejecutarWidget(WIDGET_RRSS, contexto, 'armá el plan', {
    invocador: invocadorQue({
      estrategia: 'Contenido de marca.',
      pilares: ['Producto'],
      publicaciones: [
        {
          dia: 'Viernes',
          formato: 'carrusel',
          pilar: 'Producto',
          producto: null,
          titulo: 'Nuestra cocina',
          hook: 'Así arranca un viernes en la cocina',
          desarrollo: ['Mise en place'],
          cta: 'Guardalo para tu próxima salida',
          hashtags: ['#top2026', '#gastro1000'],
        },
      ],
      promocion_propuesta: null,
      datos_insuficientes: false,
    }),
  })
  assert.deepEqual(r.cifrasNoRespaldadas, [],
    'una etiqueta no es una afirmación sobre el negocio')
})

// ---------------------------------------------------------------------------
// Asistente de escandallos
// ---------------------------------------------------------------------------

const RECETA = `Ñoquis de papa para 4 porciones
1 kg de papa
250 g de harina 0000
1 huevo
sal a gusto`

test('el contexto del escandallo son los números del propio texto', () => {
  const c = contextoEscandallo(RECETA)
  assert.equal(c.texto, RECETA)
  // El 0 sale de "harina 0000": el nombre del insumo trae dígitos, y el
  // extractor no distingue —ni tiene por qué—. Es inofensivo: agranda el
  // conjunto de cifras permitidas con un cero.
  assert.deepEqual(c.numeros_del_texto, [4, 1, 250, 0, 1])
})

test('una cantidad que no estaba en el texto se marca como inventada', async () => {
  const contexto = contextoEscandallo(RECETA)
  const r = await ejecutarWidget(WIDGET_ESCANDALLO, contexto, RECETA, {
    invocador: invocadorQue({
      nombre: 'Ñoquis de papa',
      tipo: 'plato',
      rendimiento_cantidad: 4,
      rendimiento_unidad: 'porcion',
      rendimiento_explicito: true,
      items: [
        { texto_original: '1 kg de papa', ingrediente: 'papa', cantidad: 1, unidad: 'kg', nota: '' },
        {
          texto_original: '250 g de harina 0000',
          ingrediente: 'harina 0000',
          cantidad: 250,
          unidad: 'g',
          nota: '',
        },
        // El texto dice "sal a gusto": estos 15 g los inventó el modelo.
        { texto_original: 'sal a gusto', ingrediente: 'sal fina', cantidad: 15, unidad: 'g', nota: '' },
      ],
      advertencias: [],
    }),
  })
  assert.deepEqual(r.cifrasNoRespaldadas, [15],
    'un gramaje inventado se convierte en un costo inventado')
})

test('dejar la cantidad en null no dispara la guardia', async () => {
  const contexto = contextoEscandallo(RECETA)
  const r = await ejecutarWidget(WIDGET_ESCANDALLO, contexto, RECETA, {
    invocador: invocadorQue({
      nombre: 'Ñoquis de papa',
      tipo: 'plato',
      rendimiento_cantidad: 4,
      rendimiento_unidad: 'porcion',
      rendimiento_explicito: true,
      items: [
        { texto_original: '1 kg de papa', ingrediente: 'papa', cantidad: 1, unidad: 'kg', nota: '' },
        {
          texto_original: 'sal a gusto',
          ingrediente: 'sal fina',
          cantidad: null,
          unidad: null,
          nota: 'el texto no da cantidad',
        },
      ],
      advertencias: ['La sal no tiene cantidad: completala antes de guardar.'],
    }),
  })
  assert.deepEqual(r.cifrasNoRespaldadas, [])
})

test('el emparejado con el catálogo lo hace el trigrama, no el modelo', async () => {
  const mapa = await emparejarIngredientes(USUARIO, [
    'papa',
    'harina 0000',
    'queso mozarela', // mal escrito a propósito
    'polvo de estrellas',
  ])

  assert.equal(mapa['papa'][0].nombre, 'Papa')
  assert.equal(mapa['harina 0000'][0].nombre, 'Harina 0000')

  // Un error de tipeo se resuelve igual: para eso está la similitud.
  assert.equal(mapa['queso mozarela'][0].nombre, 'Queso mozzarella')
  assert.ok(mapa['queso mozarela'][0].similitud > SIMILITUD_PARA_PRESELECCION)

  // Lo que no existe puede rozar el piso del trigrama —"polvo de estrellas"
  // roza "Pechuga de pollo" con 0,21— y por eso el umbral que importa no es
  // el de la búsqueda sino el de la PRESELECCIÓN: se ofrece como candidato,
  // pero la línea queda sin elegir y la receta no se puede guardar así.
  const disparate = mapa['polvo de estrellas']
  assert.ok(
    disparate.every((c) => c.similitud < SIMILITUD_PARA_PRESELECCION),
    'preseleccionar mal es peor que no preseleccionar: se confirma sin mirar',
  )
})

test('un parecido flojo no alcanza para preseleccionar', async () => {
  const mapa = await emparejarIngredientes(USUARIO, ['aceite'])
  const mejor = mapa['aceite'][0]
  assert.ok(mejor, 'hay candidatos: hay dos aceites en el catálogo')
  assert.ok(
    mejor.similitud < SIMILITUD_PARA_PRESELECCION,
    `"aceite" a secas no distingue oliva de girasol (similitud ${mejor.similitud})`,
  )
})

test('la guardia del escandallo mira las cantidades, no el nombre del plato', async () => {
  // Un nombre con números adentro no es una cifra sobre el negocio.
  const contexto = contextoEscandallo('Pizza 4 quesos\n300 g de harina')
  assert.deepEqual(auditarCifras('Pizza 4 quesos', contexto), [])
})

test('el esquema no deja pasar una unidad de rendimiento que no exista', async () => {
  const { EsquemaEscandallo } = await import('../lib/widgets/escandallo.ts')
  const codigos = (await sql('select codigo from unidades')).map((u) => u.codigo)

  const borrador = (unidad) => ({
    nombre: 'Ñoquis',
    tipo: 'plato',
    rendimiento_cantidad: 4,
    rendimiento_unidad: unidad,
    rendimiento_explicito: true,
    items: [],
    advertencias: [],
  })

  // "porcion" suena natural y NO está en el catálogo: si el esquema lo dejara
  // pasar, el borrador moriría recién al guardarlo, con un error de base de
  // datos en la cara de quien lo confirmó.
  assert.equal(EsquemaEscandallo.safeParse(borrador('porcion')).success, false)
  assert.equal(EsquemaEscandallo.safeParse(borrador('u')).success, true)

  // Y el vocabulario del esquema es exactamente el del catálogo.
  for (const codigo of codigos) {
    assert.equal(
      EsquemaEscandallo.safeParse(borrador(codigo)).success,
      true,
      `el catálogo tiene "${codigo}" y el esquema no lo acepta`,
    )
  }
})
