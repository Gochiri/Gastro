import { z } from 'zod'
import type { DefinicionWidget } from '../ia.ts'

/**
 * Detector de anomalías.
 *
 * El nombre es engañoso a propósito: la detección NO la hace el modelo.
 * `deteccion_anomalias()` en SQL aplica reglas con umbrales explícitos y
 * calcula el impacto en dinero de cada señal. Este widget recibe las señales
 * ya encontradas y hace lo que el SQL no puede: priorizar entre cosas de
 * naturaleza distinta y decir qué hacer con cada una.
 *
 * Un detector donde el modelo mira una tabla y opina cuál le llama la atención
 * no es reproducible, no es auditable, y un día deja de avisar sin que nadie
 * se entere.
 */

export const EsquemaAnomalias = z.object({
  resumen: z
    .string()
    .describe('Qué está pasando en el negocio, en 2 a 4 frases, empezando por lo más caro.'),
  senales: z
    .array(
      z.object({
        entidad: z.string().describe('La entidad de la señal, tal cual viene en el contexto.'),
        severidad: z.enum(['informativo', 'atencion', 'urgente']),
        que_pasa: z.string().describe('Una frase, con la cifra del contexto.'),
        causas_probables: z
          .array(z.string())
          .describe('Entre 1 y 3 explicaciones posibles, de la más probable a la menos.'),
        que_hacer: z.string().describe('Una acción concreta y verificable esta semana.'),
        como_confirmar: z
          .string()
          .describe('Qué mirar para saber si la causa es esa. Una señal no es un diagnóstico.'),
      }),
    )
    .describe('Una entrada por señal del contexto, ordenadas por impacto en dinero.'),
  falsos_positivos: z
    .array(z.string())
    .describe('Señales que probablemente no sean un problema real, y por qué. Vacío si no hay.'),
  datos_insuficientes: z.boolean(),
})

export type RespuestaAnomalias = z.infer<typeof EsquemaAnomalias>

const INSTRUCCIONES = `Analizás señales que YA fueron detectadas por reglas en la base de datos. No buscás anomalías nuevas ni descartás las que están: cada señal del contexto trae su umbral y su impacto en dinero.

Tu trabajo es el que la regla no puede hacer: explicar por qué puede estar pasando, decir qué hacer, y separar lo urgente de lo ruidoso.

- Ordená por IMPACTO EN DINERO, no por porcentaje. Un desvío del 40% sobre un insumo barato importa menos que uno del 5% sobre la carne.
- Una señal es una señal, no un diagnóstico. Un faltante de inventario puede ser robo, porciones grandes, merma sin registrar o un conteo mal hecho; decí las causas posibles y cómo distinguirlas, nunca acuses.
- Si una señal probablemente sea ruido —un umbral rozado, un período corto, un insumo de bajo consumo— ponela en falsos_positivos y explicá por qué. Un detector que grita por todo se apaga a la semana.
- 'que_hacer' tiene que ser verificable en una semana. "Revisar los costos" no sirve; "pesar tres porciones de lasaña en el turno de la noche" sí.
- No inventes señales que no estén en el contexto, por más que te parezcan probables.`

export const WIDGET_ANOMALIAS: DefinicionWidget<RespuestaAnomalias> = {
  clave: 'detector-anomalias',
  nombre: 'Detector de anomalías',
  instrucciones: INSTRUCCIONES,
  esquema: EsquemaAnomalias,
  esfuerzo: 'medium',
  auditable: (r) =>
    [
      r.resumen,
      ...r.senales.flatMap((s) => [
        s.que_pasa,
        ...s.causas_probables,
        s.que_hacer,
        s.como_confirmar,
      ]),
      ...r.falsos_positivos,
    ].join('\n'),
}
