import { z } from 'zod'
import type { DefinicionWidget } from '../ia.ts'

/**
 * Ideas para redes sociales y calendario de contenido.
 *
 * Sigue las convenciones de las skills `calendario-contenido` y
 * `copywriting-latam` del usuario: pilares de contenido, hooks de menos de
 * quince palabras, CTAs variados con fórmula verbo + beneficio, variedad
 * obligatoria de formato y pilar, y "autenticidad antes que hype".
 *
 * El aporte propio del sistema —lo que ninguna herramienta de contenido puede
 * dar— es CUÁL plato promocionar. Se alimenta de la matriz de menu engineering:
 * el plato que más se vende no es el que más conviene empujar; el que conviene
 * empujar es el rompecabezas, que deja mucho y nadie pide.
 */

export const EsquemaRrss = z.object({
  estrategia: z
    .string()
    .describe('En 2 a 3 frases: qué platos conviene empujar este período y por qué, con las cifras del contexto.'),
  pilares: z
    .array(z.string())
    .describe('Entre 3 y 4 pilares de contenido para este negocio, en dos o tres palabras cada uno.'),
  publicaciones: z
    .array(
      z.object({
        dia: z.string().describe('Día de la semana sugerido, en español.'),
        formato: z.enum(['reel', 'carrusel', 'historia', 'post', 'video_largo']),
        pilar: z.string().describe('Uno de los pilares declarados arriba.'),
        producto: z
          .string()
          .nullable()
          .describe('Plato del contexto que protagoniza la pieza, o null si la pieza no es de producto.'),
        titulo: z.string().describe('Máximo 60 caracteres.'),
        hook: z.string().describe('Primera línea. Máximo 15 palabras, tiene que generar curiosidad.'),
        desarrollo: z
          .array(z.string())
          .describe('Entre 3 y 5 puntos que cubre la pieza.'),
        cta: z.string().describe('Verbo + beneficio. Variado: no repetir el mismo CTA en dos piezas.'),
        hashtags: z.array(z.string()).describe('Entre 5 y 10, relevantes y locales.'),
      }),
    )
    .describe('Un plan semanal: entre 3 y 5 publicaciones.'),
  promocion_propuesta: z
    .object({
      idea: z.string().describe('La mecánica de la promoción.'),
      producto: z.string(),
      por_que_este: z.string().describe('La cifra de margen que la justifica.'),
      advertencia: z.string().describe('Qué margen se resigna y qué habría que verificar antes de lanzarla.'),
    })
    .nullable()
    .describe('Como máximo UNA propuesta de promoción, o null. Es una propuesta a decidir, nunca un anuncio.'),
  datos_insuficientes: z.boolean(),
})

export type RespuestaRrss = z.infer<typeof EsquemaRrss>

const INSTRUCCIONES = `Sos el estratega de contenido del restaurante. Armás un plan semanal de redes a partir de los platos que MÁS DEJAN, no de los que más se venden.

El aporte del sistema es ese cruce: mirá la matriz de menu engineering del contexto.
- ROMPECABEZAS: margen alto y poca venta. Son la prioridad absoluta del contenido: el plato ya es rentable, lo único que falta es que la gente sepa que existe.
- ESTRELLA: funciona sola. Sirve de gancho de marca y de prueba social, no necesita que le empujes volumen.
- VACA: se vende mucho y deja poco. NO la promociones: vender más de eso empeora el resultado.
- PERRO: no le dediques contenido. Está para salir de la carta, no para una campaña.

Reglas de contenido (convenciones de la casa):
- Hook de máximo 15 palabras. Pregunta provocadora, dato impactante, contraintuitivo, lista o historia.
- Título de máximo 60 caracteres.
- Variedad obligatoria: no repitas pilar dos días seguidos, alterná formatos, y que al menos una pieza de la semana sea personal o de detrás de escena, que es lo que humaniza la marca.
- CTA con fórmula verbo + beneficio ("Guardalo para tu próxima salida"), y distinto en cada pieza.
- Español rioplatense si el país es AR; ajustá el voseo al país del contexto.
- WhatsApp es el canal de contacto por defecto en LATAM: usalo en algún CTA de reserva o pedido.

Reglas de honestidad, que están por encima de todo lo anterior:
- NO INVENTES PRECIOS. Si mencionás un precio tiene que ser el precio promedio que figura en el contexto para ese plato.
- NO ANUNCIES DESCUENTOS NI PROMOCIONES dentro de una pieza. Una promoción es una decisión del dueño, no una decisión de copy. Si querés proponer una, va en promocion_propuesta, con el margen que se resigna dicho de frente.
- Nada de urgencia falsa ni "últimos lugares" si no hay un motivo real. Destruye la credibilidad y en este mercado no se recupera.
- No prometas atributos que no estén en el contexto: si no sabés que el plato es casero, artesanal o sin TACC, no lo digas.`

export const WIDGET_RRSS: DefinicionWidget<RespuestaRrss> = {
  clave: 'ideas-rrss',
  nombre: 'Ideas para redes',
  instrucciones: INSTRUCCIONES,
  esquema: EsquemaRrss,
  esfuerzo: 'medium',
  // Los hashtags NO se auditan: son etiquetas, no afirmaciones sobre el
  // negocio, y un "#top10" haría saltar la guardia sin motivo.
  auditable: (r) =>
    [
      r.estrategia,
      ...r.publicaciones.flatMap((p) => [p.titulo, p.hook, ...p.desarrollo, p.cta]),
      ...(r.promocion_propuesta
        ? [
            r.promocion_propuesta.idea,
            r.promocion_propuesta.por_que_este,
            r.promocion_propuesta.advertencia,
          ]
        : []),
    ].join('\n'),
}
