import { z } from 'zod'
import type { DefinicionWidget } from '../ia.ts'

/**
 * Asistente de escandallos: texto libre a ficha técnica.
 *
 * Es el único widget que produce algo que se puede GUARDAR, y por eso es el
 * que más restricciones tiene:
 *
 *   1. El modelo solo ESTRUCTURA. Extrae ingrediente, cantidad y unidad del
 *      texto que pegó la persona. No inventa cantidades, no completa lo que
 *      falta con lo que "suele llevar" una receta, no elige el insumo del
 *      catálogo.
 *   2. El emparejado con el catálogo lo hace el trigrama de Postgres
 *      (`proponer_insumos`), igual que con los productos del importador. Un
 *      ingrediente mal emparejado mete el costo equivocado en la ficha y
 *      contamina todo lo que se calcula después, sin que nada falle de forma
 *      visible.
 *   3. Nada se guarda sin confirmación humana. La pantalla muestra el borrador
 *      con un selector por línea y el botón de guardar recién aparece cuando
 *      todas las líneas tienen insumo elegido.
 *
 * La auditoría de cifras se hace contra los números del TEXTO DE ENTRADA, no
 * contra la base: acá inventar es agregar un gramaje que la persona nunca
 * escribió.
 */

export const EsquemaEscandallo = z.object({
  nombre: z.string().describe('Nombre de la receta, tomado del texto. Si no hay, uno descriptivo y corto.'),
  tipo: z
    .enum(['plato', 'subreceta'])
    .describe('subreceta si es una base que se usa dentro de otras (una salsa, un fondo, una masa).'),
  rendimiento_cantidad: z
    .number()
    .describe('Cuántas porciones o cuánto volumen rinde. Si el texto no lo dice, 1.'),
  // Vocabulario cerrado a propósito: son las unidades que existen en el
  // catálogo. Si el modelo pudiera devolver "porcion" o "taza", el borrador
  // moriría recién al guardarlo, con un error de base de datos en la cara.
  rendimiento_unidad: z
    .enum(['u', 'g', 'kg', 'ml', 'l'])
    .describe('Unidad del rendimiento. Las porciones son "u". Si el texto no lo dice, "u".'),
  rendimiento_explicito: z
    .boolean()
    .describe('true solo si el rendimiento estaba escrito en el texto. false si lo pusiste por defecto.'),
  items: z
    .array(
      z.object({
        texto_original: z
          .string()
          .describe('El fragmento del texto de donde sale esta línea, literal.'),
        ingrediente: z.string().describe('El nombre del ingrediente, limpio, sin cantidad ni preparación.'),
        cantidad: z.number().nullable().describe('null si el texto no da una cantidad. NUNCA la estimes.'),
        // Acá SÍ es texto libre, y es deliberado: si la receta dice "2 tazas",
        // la unidad tiene que llegar como "taza" a la pantalla. Convertirla o
        // forzarla a "ml" sería inventar una equivalencia. La pantalla la marca
        // como no válida y obliga a resolverla a mano.
        unidad: z
          .string()
          .nullable()
          .describe('La unidad tal como está escrita en el texto. null si no la da o si dice "a gusto".'),
        nota: z
          .string()
          .describe('Preparación mencionada (picado, en juliana) o el motivo por el que falta la cantidad.'),
      }),
    )
    .describe('Una línea por ingrediente del texto, en el orden en que aparecen.'),
  advertencias: z
    .array(z.string())
    .describe('Qué quedó sin resolver: cantidades ausentes, unidades ambiguas, ingredientes que no parecen tales.'),
})

export type RespuestaEscandallo = z.infer<typeof EsquemaEscandallo>

const INSTRUCCIONES = `Convertís una receta escrita en texto libre en una ficha técnica estructurada. Sos un transcriptor estructurado, no un cocinero.

LO QUE NO HACÉS, bajo ninguna circunstancia:
- No agregás ingredientes que el texto no menciona, por más que la receta "clásica" los lleve. Si falta la sal, falta.
- No estimás cantidades. Si el texto dice "un chorrito de aceite" o "sal a gusto", la cantidad va en null y el motivo en la nota. Un gramaje inventado se convierte en un costo inventado y de ahí en un precio de venta mal calculado.
- No elegís el insumo del catálogo. Devolvés el nombre del ingrediente como está escrito; el emparejado lo hace el sistema.
- No convertís unidades. Si dice "2 tazas", la unidad es la que dice el texto y va como advertencia.

LO QUE SÍ HACÉS:
- Separás cantidad, unidad e ingrediente de cada línea, aunque estén escritos de corrido.
- Limpiás el nombre del ingrediente: "200 g de queso mozzarella rallado" es ingrediente "queso mozzarella", nota "rallado".
- Si el texto declara un rendimiento ("para 8 porciones", "rinde 2 litros"), lo tomás y marcás rendimiento_explicito en true. Las porciones se expresan con la unidad "u". Si no lo declara, ponés 1 u y rendimiento_explicito en false, porque el rendimiento divide el costo de toda la ficha y quien la revise tiene que saber que ese número lo pusiste vos.
- Todo lo que quede dudoso va en advertencias. Una ficha con advertencias que se revisan es infinitamente mejor que una que parece completa y no lo está.`

export const WIDGET_ESCANDALLO: DefinicionWidget<RespuestaEscandallo> = {
  clave: 'asistente-escandallos',
  nombre: 'Asistente de escandallos',
  instrucciones: INSTRUCCIONES,
  esquema: EsquemaEscandallo,
  esfuerzo: 'low',
  // Se auditan las cantidades extraídas contra los números del texto original.
  auditable: (r) =>
    [
      ...r.items.map((i) => (i.cantidad === null ? '' : String(i.cantidad))),
      r.rendimiento_explicito ? String(r.rendimiento_cantidad) : '',
      ...r.advertencias,
    ].join('\n'),
}
