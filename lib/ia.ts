import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { z } from 'zod'
import type { ContextoNegocio } from '../consultas/contexto-ia.ts'

/**
 * Cliente de IA para los widgets.
 *
 * Se ejecuta SOLO en el servidor: la clave nunca llega al navegador.
 *
 * Dos garantías de diseño:
 *   1. El modelo recibe métricas ya calculadas y tiene prohibido operar con
 *      ellas. Todo lo que podría necesitar —incluidas las diferencias y los
 *      porcentajes— viene resuelto en el contexto.
 *   2. Cada respuesta se audita: se extraen sus números y se verifican contra
 *      los del contexto. Los que no aparezcan se registran y se muestran como
 *      advertencia. La confianza en un producto financiero no se recupera.
 */

export const MODELO = 'claude-opus-5'

/** Precios por millón de tokens de claude-opus-5. */
const USD_POR_MTOK_ENTRADA = 5
const USD_POR_MTOK_SALIDA = 25

export const EsquemaRespuesta = z.object({
  respuesta: z
    .string()
    .describe('Respuesta directa a la pregunta, en 2 a 5 frases, en español rioplatense.'),
  hallazgos: z
    .array(
      z.object({
        titulo: z.string().describe('Qué se observó, en una frase corta.'),
        detalle: z.string().describe('Por qué importa, citando las cifras del contexto.'),
        severidad: z.enum(['informativo', 'atencion', 'urgente']),
      }),
    )
    .describe('Entre 0 y 3 observaciones relevantes que respondan a la pregunta.'),
  recomendaciones: z
    .array(z.string())
    .describe('Entre 0 y 3 acciones concretas. Vacío si los datos no alcanzan para recomendar.'),
  datos_insuficientes: z
    .boolean()
    .describe('true si el contexto no alcanza para responder la pregunta con honestidad.'),
})

export type RespuestaIa = z.infer<typeof EsquemaRespuesta>

export interface ResultadoIa {
  respuesta: RespuestaIa
  cifrasNoRespaldadas: number[]
  tokensEntrada: number
  tokensSalida: number
  tokensCacheLectura: number
  costoUsd: number
  duracionMs: number
  modelo: string
}

const INSTRUCCIONES = `Sos el analista de un sistema de gestión gastronómica. Respondés preguntas del dueño de un restaurante sobre los resultados de su negocio.

REGLA ABSOLUTA: no calculás nada. Todas las cifras que necesitás ya vienen resueltas en el contexto, incluidas las diferencias y los porcentajes. Está terminantemente prohibido sumar, restar, promediar o estimar un número que no esté literalmente en el contexto. Si para responder hiciera falta una cifra que no está, decilo y marcá datos_insuficientes.

Cómo responder:
- Citá las cifras tal como aparecen en el contexto, sin redondearlas ni reexpresarlas.
- Hablá en español rioplatense, directo y sin adornos. Nada de "es importante destacar".
- Si la cobertura de costeo es menor al 100%, aclarálo cuando hables de food cost: ese número cubre solo parte del negocio.
- Si la cobertura del conteo de inventario es parcial, el food cost real es una estimación y hay que decirlo.
- Un producto con margen null no tiene ficha técnica cargada: no es que su margen sea cero, es que se desconoce. Nunca lo presentes como el más rentable.
- Si los datos no alcanzan para responder, decilo. Es preferible a inventar.`

/**
 * Todos los valores numéricos de un objeto, aplanados.
 * Es el conjunto contra el que se verifica que la respuesta no invente cifras.
 *
 * Vive acá y no junto al constructor de contexto para que la auditoría sea una
 * función pura: se puede importar y probar sin abrir una conexión a la base.
 */
export function valoresNumericos(valor: unknown, acumulado = new Set<number>()): Set<number> {
  if (typeof valor === 'number' && Number.isFinite(valor)) {
    acumulado.add(Math.abs(valor))
  } else if (Array.isArray(valor)) {
    for (const x of valor) valoresNumericos(x, acumulado)
  } else if (valor && typeof valor === 'object') {
    for (const x of Object.values(valor)) valoresNumericos(x, acumulado)
  }
  return acumulado
}

/**
 * Lecturas plausibles de un número escrito.
 *
 * "1.500" puede ser mil quinientos (agrupación LATAM) o uno coma cinco
 * (decimal anglosajón), y en una frase suelta no hay forma de saberlo. El
 * auditor no elige: genera las dos y da por buena la cifra si CUALQUIERA
 * coincide con el contexto.
 *
 * La asimetría es deliberada. Acusar de inventada una cifra correcta enseña a
 * la gente a ignorar la advertencia, y entonces deja de servir para el caso
 * que importa.
 */
export function lecturasPosibles(token: string): number[] {
  const limpio = token.replace(/[.,]+$/, '')
  if (!limpio) return []

  const puntos = (limpio.match(/\./g) ?? []).length
  const comas = (limpio.match(/,/g) ?? []).length
  const lecturas = new Set<number>()

  const agregar = (texto: string): void => {
    const v = Number(texto)
    if (Number.isFinite(v)) lecturas.add(Math.abs(v))
  }

  if (puntos > 0 && comas > 0) {
    // Ambos presentes: el último es el decimal, sin ambigüedad.
    if (limpio.lastIndexOf(',') > limpio.lastIndexOf('.')) {
      agregar(limpio.replace(/\./g, '').replace(',', '.'))
    } else {
      agregar(limpio.replace(/,/g, ''))
    }
    return [...lecturas]
  }

  const separador = puntos > 0 ? '.' : comas > 0 ? ',' : null
  if (!separador) {
    agregar(limpio)
    return [...lecturas]
  }

  const partes = limpio.split(separador)
  const agrupacionValida =
    partes.length > 1 && partes.slice(1).every((p) => p.length === 3)

  // Lectura como separador de miles.
  if (agrupacionValida) agregar(partes.join(''))
  // Lectura como separador decimal (solo si aparece una vez).
  if (partes.length === 2) agregar(`${partes[0]}.${partes[1]}`)

  return [...lecturas]
}

/**
 * Números citados en un texto, en su lectura más probable.
 *
 * Para esta aplicación —español rioplatense— la convención LATAM manda: ante
 * la duda, el punto agrupa.
 */
export function numerosDelTexto(texto: string): number[] {
  const encontrados: number[] = []
  for (const m of texto.matchAll(/-?\d[\d.,]*/g)) {
    const lecturas = lecturasPosibles(m[0])
    if (lecturas.length > 0) encontrados.push(Math.max(...lecturas))
  }
  return encontrados
}

/**
 * Cifras de la respuesta que no están en el contexto.
 *
 * Los enteros hasta 12 se permiten sin respaldo: son conteos y meses ("los 3
 * canales", "en 4 días"), no afirmaciones sobre el negocio. Todo lo demás debe
 * coincidir con un valor del contexto, con tolerancia para el redondeo a dos
 * decimales que hace la interfaz.
 */
export function auditarCifras(texto: string, contexto: unknown): number[] {
  const permitidos = valoresNumericos(contexto)
  const sinRespaldo: number[] = []

  const coincide = (valor: number): boolean =>
    [...permitidos].some((p) => {
      const tolerancia = Math.max(Math.abs(p) * 0.005, 0.01)
      return Math.abs(p - valor) <= tolerancia
    })

  for (const m of texto.matchAll(/-?\d[\d.,]*/g)) {
    const lecturas = lecturasPosibles(m[0])
    if (lecturas.length === 0) continue
    // Conteos y días: enteros chicos que no afirman nada sobre el negocio.
    if (lecturas.some((v) => Number.isInteger(v) && v <= 12)) continue
    if (lecturas.some(coincide)) continue

    const principal = Math.max(...lecturas)
    if (!sinRespaldo.includes(principal)) sinRespaldo.push(principal)
  }
  return sinRespaldo
}

function textoAuditable(r: RespuestaIa): string {
  return [
    r.respuesta,
    ...r.hallazgos.flatMap((h) => [h.titulo, h.detalle]),
    ...r.recomendaciones,
  ].join('\n')
}

/** La llamada al modelo, aislada para poder sustituirla en tests. */
export type Invocador = (args: {
  sistema: string
  contexto: string
  pregunta: string
  esfuerzo: string
}) => Promise<{
  respuesta: RespuestaIa
  tokensEntrada: number
  tokensSalida: number
  tokensCacheLectura: number
  modelo: string
}>

const invocadorReal: Invocador = async ({ sistema, contexto, pregunta, esfuerzo }) => {
  const cliente = new Anthropic()

  const mensaje = await cliente.messages.parse({
    model: MODELO,
    max_tokens: 4000,
    system: [
      // El bloque estable va primero y se cachea: se repite en cada pregunta.
      { type: 'text', text: sistema, cache_control: { type: 'ephemeral' } },
    ],
    thinking: { type: 'adaptive' },
    output_config: {
      effort: esfuerzo as 'low' | 'medium' | 'high' | 'xhigh' | 'max',
      format: zodOutputFormat(EsquemaRespuesta),
    },
    messages: [
      {
        role: 'user',
        content: `Contexto del período (todas las cifras ya calculadas):\n\n${contexto}\n\nPregunta: ${pregunta}`,
      },
    ],
  })

  if (mensaje.stop_reason === 'refusal') {
    throw new Error(
      'El modelo declinó responder esta consulta. Probá reformular la pregunta.',
    )
  }
  if (!mensaje.parsed_output) {
    throw new Error('La respuesta del modelo no pudo interpretarse.')
  }

  return {
    respuesta: mensaje.parsed_output,
    tokensEntrada: mensaje.usage.input_tokens ?? 0,
    tokensSalida: mensaje.usage.output_tokens ?? 0,
    tokensCacheLectura: mensaje.usage.cache_read_input_tokens ?? 0,
    modelo: mensaje.model ?? MODELO,
  }
}

export async function explicarKpis(
  contexto: ContextoNegocio,
  pregunta: string,
  opciones: { esfuerzo?: string; invocador?: Invocador } = {},
): Promise<ResultadoIa> {
  const invocador = opciones.invocador ?? invocadorReal
  const arranque = Date.now()

  const salida = await invocador({
    sistema: INSTRUCCIONES,
    contexto: JSON.stringify(contexto, null, 2),
    pregunta,
    esfuerzo: opciones.esfuerzo ?? 'medium',
  })

  const cifrasNoRespaldadas = auditarCifras(textoAuditable(salida.respuesta), contexto)

  const costoUsd =
    (salida.tokensEntrada / 1_000_000) * USD_POR_MTOK_ENTRADA +
    (salida.tokensSalida / 1_000_000) * USD_POR_MTOK_SALIDA

  return {
    respuesta: salida.respuesta,
    cifrasNoRespaldadas,
    tokensEntrada: salida.tokensEntrada,
    tokensSalida: salida.tokensSalida,
    tokensCacheLectura: salida.tokensCacheLectura,
    costoUsd: Math.round(costoUsd * 1e6) / 1e6,
    duracionMs: Date.now() - arranque,
    modelo: salida.modelo,
  }
}

export function hayCredenciales(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN)
}
