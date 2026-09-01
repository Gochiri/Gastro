import { z } from 'zod'
import type { DefinicionWidget } from '../ia.ts'

/**
 * Analista de menu engineering.
 *
 * La clasificación de cada plato (estrella / vaca / rompecabezas / perro) YA
 * viene resuelta en SQL por `matriz_menu()`. Este widget no clasifica: lee la
 * matriz y dice qué hacer con cada plato, que es la parte que un dueño de
 * restaurante no puede sacar de una tabla.
 */

export const EsquemaMenu = z.object({
  lectura: z
    .string()
    .describe('Cómo está compuesta la carta, en 2 a 4 frases. Sin listar plato por plato.'),
  platos: z
    .array(
      z.object({
        producto: z.string().describe('Nombre exacto del plato, tal como está en la matriz.'),
        clasificacion: z.enum(['estrella', 'vaca', 'rompecabezas', 'perro']),
        accion: z
          .enum([
            'mantener',
            'subir_precio',
            'bajar_costo',
            'dar_visibilidad',
            'rediseñar',
            'retirar',
          ])
          .describe('Una sola acción, la más importante para este plato.'),
        por_que: z
          .string()
          .describe('Dos frases con las cifras de la matriz que justifican la acción.'),
        riesgo: z
          .string()
          .describe('Qué puede salir mal si se hace. Vacío no es una opción: toda acción tiene un costo.'),
      }),
    )
    .describe('Una entrada por plato de la matriz, en orden de prioridad.'),
  orden_de_ataque: z
    .array(z.string())
    .describe('Entre 1 y 3 platos por los que empezar, con una frase de por qué esos.'),
  datos_insuficientes: z
    .boolean()
    .describe('true si la matriz cubre tan poco del negocio que las conclusiones no son confiables.'),
})

export type RespuestaMenu = z.infer<typeof EsquemaMenu>

const INSTRUCCIONES = `Sos consultor de ingeniería de menú. Recibís la matriz de Kasavana-Smith YA CLASIFICADA y recomendás qué hacer con cada plato.

No reclasifiques. La casilla de cada plato ya está decidida en el contexto; discutirla es perder el tiempo del dueño.

Qué pide cada cuadrante:
- ESTRELLA: alta popularidad y alto margen. No se le toca el precio ni la receta. Se le da el mejor lugar de la carta y se lo usa de gancho.
- VACA (alta popularidad, margen bajo): sostiene el volumen. Se trabaja el COSTO —porción, proveedor, guarnición— antes que el precio: subirle el precio a lo que más se vende es lo que más rápido espanta clientes.
- ROMPECABEZAS (margen alto, poca venta): el plato es bueno y nadie lo pide. Se ataca la visibilidad: descripción, foto, ubicación en la carta, sugerencia del mozo. Bajarle el precio es la última opción, no la primera.
- PERRO (poca venta, margen bajo): candidato a salir. Antes de retirarlo hay que ver si comparte insumos con otros platos: sacarlo puede encarecer las compras del resto.

Reglas que no se negocian:
- Mirá la distancia a cada umbral. Un plato que está a menos del 10% del umbral de margen o de popularidad está en el borde: su casilla se da vuelta con una semana distinta, y la recomendación tiene que decirlo en vez de tratarlo como un veredicto.
- El margen se compara POR UNIDAD, no por porcentaje. Un plato con 70% de margen sobre $2.000 deja menos que uno con 30% sobre $12.000.
- Si la cobertura de la matriz no llega al 100%, hay platos sin ficha técnica que no están clasificados. Decilo en la lectura: la carta que estás analizando no es toda la carta.
- Nunca recomiendes retirar un plato que no esté clasificado como perro.
- Toda acción lleva su riesgo. Un consejo sin contraindicación es un consejo que nadie puede evaluar.`

export const WIDGET_MENU: DefinicionWidget<RespuestaMenu> = {
  clave: 'menu-engineering',
  nombre: 'Analista de menú',
  instrucciones: INSTRUCCIONES,
  esquema: EsquemaMenu,
  // Esfuerzo alto: es una recomendación de estrategia de carta, no una lectura
  // de tablero. Se paga una vez por período, no en cada pantalla.
  esfuerzo: 'high',
  auditable: (r) =>
    [
      r.lectura,
      ...r.platos.flatMap((p) => [p.por_que, p.riesgo]),
      ...r.orden_de_ataque,
    ].join('\n'),
}
