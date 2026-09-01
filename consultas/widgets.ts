import { consultar, withTenant } from '../lib/db.ts'
import { numerosDelTexto } from '../lib/ia.ts'
import type { Periodo } from './kpis.ts'

/**
 * Constructores de contexto de los widgets analíticos.
 *
 * Misma regla que en `contexto-ia.ts` y sin excepciones: todo lo que el modelo
 * podría necesitar viene calculado en SQL. Acá no se suma, no se promedia y no
 * se clasifica: la matriz de menu engineering la arma `matriz_menu()` y las
 * anomalías las detecta `deteccion_anomalias()`.
 */

export interface FilaMatriz {
  productoId: string
  producto: string
  categoria: string | null
  unidades: number
  ventas: number
  margen: number
  margenUnitario: number
  precioPromedio: number
  margenPct: number | null
  popularidadPct: number | null
  umbralPopularidadPct: number | null
  margenReferencia: number
  distanciaMargen: number
  distanciaPopularidad: number
  clasificacion: 'estrella' | 'vaca' | 'rompecabezas' | 'perro'
}

export interface CoberturaMatriz {
  productosClasificados: number
  productosSinFicha: number
  unidadesClasificadas: number
  unidadesSinFicha: number
  ventasClasificadas: number
  ventasSinFicha: number
  coberturaPct: number | null
}

export interface Anomalia {
  tipo: string
  severidad: 'informativo' | 'atencion' | 'urgente'
  entidad: string
  detalle: string
  valor: number | null
  referencia: number | null
  desvioPct: number | null
  umbral: number | null
  impactoDinero: number | null
}

export interface CandidatoInsumo {
  insumoId: string
  nombre: string
  unidadBase: string
  similitud: number
}

const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v))
const numOpc = (v: unknown): number | null =>
  v === null || v === undefined ? null : Number(v)

// ---------------------------------------------------------------------------
// Matriz de menu engineering
// ---------------------------------------------------------------------------

export async function matrizMenu(
  usuarioId: string,
  periodo: Periodo,
): Promise<FilaMatriz[]> {
  const filas = await consultar<Record<string, unknown>>(
    usuarioId,
    'select * from matriz_menu($1::date, $2::date)',
    [periodo.desde, periodo.hasta],
  )
  return filas.map((f) => ({
    productoId: String(f.producto_id),
    producto: String(f.producto),
    categoria: (f.categoria as string) ?? null,
    unidades: num(f.unidades),
    ventas: num(f.ventas),
    margen: num(f.margen),
    margenUnitario: num(f.margen_unitario),
    precioPromedio: num(f.precio_promedio),
    margenPct: numOpc(f.margen_pct),
    popularidadPct: numOpc(f.popularidad_pct),
    umbralPopularidadPct: numOpc(f.umbral_popularidad_pct),
    margenReferencia: num(f.margen_referencia),
    distanciaMargen: num(f.distancia_margen),
    distanciaPopularidad: num(f.distancia_popularidad),
    clasificacion: String(f.clasificacion) as FilaMatriz['clasificacion'],
  }))
}

export async function coberturaMatriz(
  usuarioId: string,
  periodo: Periodo,
): Promise<CoberturaMatriz> {
  const filas = await consultar<Record<string, unknown>>(
    usuarioId,
    'select * from matriz_menu_cobertura($1::date, $2::date)',
    [periodo.desde, periodo.hasta],
  )
  const f = filas[0] ?? {}
  return {
    productosClasificados: num(f.productos_clasificados),
    productosSinFicha: num(f.productos_sin_ficha),
    unidadesClasificadas: num(f.unidades_clasificadas),
    unidadesSinFicha: num(f.unidades_sin_ficha),
    ventasClasificadas: num(f.ventas_clasificadas),
    ventasSinFicha: num(f.ventas_sin_ficha),
    coberturaPct: numOpc(f.cobertura_pct),
  }
}

// ---------------------------------------------------------------------------
// Anomalías
// ---------------------------------------------------------------------------

export async function anomalias(
  usuarioId: string,
  periodo: Periodo,
): Promise<Anomalia[]> {
  const filas = await consultar<Record<string, unknown>>(
    usuarioId,
    'select * from deteccion_anomalias($1::date, $2::date)',
    [periodo.desde, periodo.hasta],
  )
  return filas.map((f) => ({
    tipo: String(f.tipo),
    severidad: String(f.severidad) as Anomalia['severidad'],
    entidad: String(f.entidad),
    detalle: String(f.detalle),
    valor: numOpc(f.valor),
    referencia: numOpc(f.referencia),
    desvioPct: numOpc(f.desvio_pct),
    umbral: numOpc(f.umbral),
    impactoDinero: numOpc(f.impacto_dinero),
  }))
}

export async function parametrosAnomalias(
  usuarioId: string,
): Promise<{ parametro: string; valor: number; descripcion: string }[]> {
  const filas = await consultar<Record<string, unknown>>(
    usuarioId,
    'select * from parametros_anomalias()',
  )
  return filas.map((f) => ({
    parametro: String(f.parametro),
    valor: num(f.valor),
    descripcion: String(f.descripcion),
  }))
}

// ---------------------------------------------------------------------------
// Contextos para el modelo
// ---------------------------------------------------------------------------

interface Cabecera {
  organizacion: { nombre: string; pais: string; moneda: string }
  periodo: Periodo
}

async function cabecera(usuarioId: string, periodo: Periodo): Promise<Cabecera | null> {
  const filas = await consultar<Record<string, string>>(
    usuarioId,
    'select nombre, pais, moneda from organizaciones order by nombre limit 1',
  )
  if (!filas[0]) return null
  return {
    organizacion: {
      nombre: filas[0].nombre,
      pais: filas[0].pais,
      moneda: filas[0].moneda,
    },
    periodo,
  }
}

export async function contextoMenu(
  usuarioId: string,
  periodo: Periodo,
): Promise<Record<string, unknown> | null> {
  const cab = await cabecera(usuarioId, periodo)
  if (!cab) return null
  const [matriz, cobertura] = await Promise.all([
    matrizMenu(usuarioId, periodo),
    coberturaMatriz(usuarioId, periodo),
  ])
  if (matriz.length === 0) return null
  return {
    ...cab,
    // El significado de cada casilla viaja con los datos: sin esto el modelo
    // tiene que acordarse del método, y acordarse mal es una recomendación mal
    // dada sobre la carta de alguien.
    metodo: {
      nombre: 'Kasavana-Smith',
      eje_popularidad:
        'participación en unidades contra el 70% del reparto parejo entre los platos clasificados',
      eje_margen: 'margen de contribución POR UNIDAD contra el margen unitario ponderado del conjunto',
      cuadrantes: {
        estrella: 'popular y rentable',
        vaca: 'popular y poco rentable',
        rompecabezas: 'rentable y poco vendido',
        perro: 'poco vendido y poco rentable',
      },
    },
    matriz,
    cobertura,
  }
}

export async function contextoAnomalias(
  usuarioId: string,
  periodo: Periodo,
): Promise<Record<string, unknown> | null> {
  const cab = await cabecera(usuarioId, periodo)
  if (!cab) return null
  const [senales, parametros] = await Promise.all([
    anomalias(usuarioId, periodo),
    parametrosAnomalias(usuarioId),
  ])
  return {
    ...cab,
    // Los umbrales van en el contexto para que el modelo pueda decir contra qué
    // vara se midió cada señal. Un aviso que no lo dice no se puede discutir.
    parametros,
    senales,
  }
}

export async function contextoRrss(
  usuarioId: string,
  periodo: Periodo,
): Promise<Record<string, unknown> | null> {
  const cab = await cabecera(usuarioId, periodo)
  if (!cab) return null
  const [matriz, cobertura] = await Promise.all([
    matrizMenu(usuarioId, periodo),
    coberturaMatriz(usuarioId, periodo),
  ])
  if (matriz.length === 0) return null
  return {
    ...cab,
    // Solo lo que el contenido necesita: qué plato empujar, a qué precio se
    // vende y cuánto deja. Nada de costos internos: no van a una red social ni
    // por accidente.
    platos: matriz.map((f) => ({
      producto: f.producto,
      categoria: f.categoria,
      clasificacion: f.clasificacion,
      precio_promedio: f.precioPromedio,
      margen_unitario: f.margenUnitario,
      unidades_vendidas: f.unidades,
    })),
    cobertura_matriz_pct: cobertura.coberturaPct,
  }
}

/**
 * Contexto del asistente de escandallos.
 *
 * Es el único que no sale de la base: el universo de cifras legítimas de la
 * respuesta es el texto que pegó la persona. Por eso los números del texto
 * viajan explícitos, y son contra ellos que la guardia audita las cantidades
 * extraídas: acá "inventar" es agregar un gramaje que nadie escribió.
 */
export function contextoEscandallo(texto: string): Record<string, unknown> {
  return {
    texto,
    numeros_del_texto: numerosDelTexto(texto),
  }
}

// ---------------------------------------------------------------------------
// Emparejado de ingredientes con el catálogo
// ---------------------------------------------------------------------------

/**
 * Candidatos de catálogo para cada ingrediente extraído por el modelo.
 *
 * El emparejado lo hace el trigrama de Postgres, no el modelo, por la misma
 * razón que en el importador de ventas: un emparejado automático equivocado
 * mete el costo de otro insumo en la ficha y no falla de forma visible.
 */
export async function emparejarIngredientes(
  usuarioId: string,
  ingredientes: string[],
): Promise<Record<string, CandidatoInsumo[]>> {
  if (ingredientes.length === 0) return {}
  return withTenant(usuarioId, async (cliente) => {
    const salida: Record<string, CandidatoInsumo[]> = {}
    for (const ingrediente of ingredientes) {
      const { rows } = await cliente.query<Record<string, unknown>>(
        'select * from proponer_insumos($1, 5)',
        [ingrediente],
      )
      salida[ingrediente] = rows.map((r) => ({
        insumoId: String(r.insumo_id),
        nombre: String(r.nombre),
        unidadBase: String(r.unidad_base),
        similitud: num(r.similitud),
      }))
    }
    return salida
  })
}

/**
 * Umbral por encima del cual se preselecciona un candidato.
 *
 * Deliberadamente alto. Preseleccionar mal es peor que no preseleccionar: la
 * persona confirma sin mirar, y el costo equivocado entra a la ficha sin que
 * nada avise. Por debajo de esto la línea queda sin elegir y no se puede
 * guardar la receta.
 */
export const SIMILITUD_PARA_PRESELECCION = 0.6

/** Códigos de unidad del catálogo, para los selectores del borrador. */
export async function unidadesDisponibles(usuarioId: string): Promise<string[]> {
  const filas = await consultar<Record<string, unknown>>(
    usuarioId,
    'select codigo from unidades order by dimension, codigo',
  )
  return filas.map((f) => String(f.codigo))
}
