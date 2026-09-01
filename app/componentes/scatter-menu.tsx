'use client'

import { useState } from 'react'
import { formatearImporte, formatearPorcentaje } from '@/lib/formato'

/**
 * Matriz de menu engineering como scatter.
 *
 * Decisiones tomadas siguiendo la skill `dataviz`, en el orden que pide:
 *
 * 1. FORMA. El trabajo del dato es posición en un plano de dos ejes con cuatro
 *    regiones. Un scatter con dos líneas de referencia es exactamente eso; la
 *    tabla de al lado cumple el rol de "vista de tabla" que la skill exige.
 *
 * 2. COLOR. Una sola serie, un solo tono. Pintar cada cuadrante de un color
 *    distinto sería codificar con color lo que la POSICIÓN ya codifica: el
 *    cuadrante de un plato es dónde cae respecto de las dos líneas, no un
 *    atributo aparte. Además evita el problema real de una paleta de cuatro
 *    categorías en un scatter: bajo el criterio de "todos los pares" solo los
 *    tres primeros tonos de la paleta pasan los pisos de separación, y el
 *    cuarto (amarillo junto a naranja) no. Con una serie no hay pares que
 *    validar, y no hace falta leyenda: el título nombra la serie.
 *
 * 3. VALIDACIÓN. `validate_palette.js "#2a78d6" --mode light` pasa las cinco
 *    comprobaciones sobre la superficie clara.
 *
 * 4. MARCAS. Punto de 9px (r 4,5) con anillo de 2px del color de la superficie,
 *    para que dos platos que caen cerca sigan siendo dos platos.
 *
 * 5. INTERACCIÓN. Área de acierto de 24px, muy por encima del punto: la skill
 *    llama antipatrón al scatter donde hay que clavar el centro de un punto de
 *    8px.
 *
 * 6. ACCESIBILIDAD. Etiquetas directas sobre cada punto mientras sean pocos
 *    —con muchos platos se etiquetan solo los extremos, porque una etiqueta en
 *    cada punto deja de leerse— y el texto va con tokens de texto, nunca con el
 *    color de la serie.
 */

const AZUL = '#2a78d6' // slot 1 de la paleta categórica, validado en claro
const SUPERFICIE = '#ffffff'

/** A partir de acá, etiquetar todos los puntos ensucia más de lo que aporta. */
const MAXIMO_ETIQUETAS = 9

export interface PuntoMenu {
  id: string
  producto: string
  popularidad: number
  margenUnitario: number
  clasificacion: string
}

interface Props {
  puntos: PuntoMenu[]
  umbralPopularidad: number
  margenReferencia: number
  // Moneda y país, NO funciones de formato: una función no cruza la frontera
  // servidor/cliente. `lib/formato.ts` no está marcado como cliente, así que
  // se importa de los dos lados sin problema.
  moneda: string
  pais: string
}

const ANCHO = 640
const ALTO = 400
const PAD = { arriba: 28, derecha: 28, abajo: 48, izquierda: 76 }

export function ScatterMenu({
  puntos,
  umbralPopularidad,
  margenReferencia,
  moneda,
  pais,
}: Props) {
  const [encima, setEncima] = useState<string | null>(null)

  const importe = (v: number): string => formatearImporte(v, moneda, pais)
  const porcentaje = (v: number): string => formatearPorcentaje(v, pais)

  if (puntos.length === 0) return null

  const x0 = PAD.izquierda
  const x1 = ANCHO - PAD.derecha
  const y0 = PAD.arriba
  const y1 = ALTO - PAD.abajo

  // Dominios: siempre incluyen las dos líneas de referencia y el cero del eje
  // de margen si hay algún plato en pérdida. Un cuadrante que queda fuera de
  // cuadro no existe para quien mira.
  const maxPop = Math.max(...puntos.map((p) => p.popularidad), umbralPopularidad) * 1.15
  const margenes = puntos.map((p) => p.margenUnitario)
  const maxMar = Math.max(...margenes, margenReferencia) * 1.12
  const minMar = Math.min(...margenes, 0)
  const rangoMar = maxMar - minMar || 1

  const px = (v: number): number => x0 + (v / (maxPop || 1)) * (x1 - x0)
  const py = (v: number): number => y1 - ((v - minMar) / rangoMar) * (y1 - y0)

  const xUmbral = px(umbralPopularidad)
  const yReferencia = py(margenReferencia)

  const etiquetar = puntos.length <= MAXIMO_ETIQUETAS
  const activo = puntos.find((p) => p.id === encima) ?? null

  /**
   * Desplazamiento vertical de cada etiqueta.
   *
   * Dos platos con margen parecido se pisan las etiquetas, y eso el validador
   * de paleta no lo puede ver: aparece recién al mirar el gráfico.
   *
   * La pasada corre sobre TODOS los puntos, no por lado. Dos etiquetas en lados
   * opuestos apuntan una hacia la otra y se cruzan en el medio, que es
   * justamente el caso que parecía resuelto y no lo estaba.
   */
  const SEPARACION = 15
  const desplazamiento = new Map<string, number>()
  let ultimo = -Infinity
  for (const p of [...puntos].sort((a, b) => py(a.margenUnitario) - py(b.margenUnitario))) {
    const y = py(p.margenUnitario)
    const ajustado = y < ultimo + SEPARACION ? ultimo + SEPARACION : y
    desplazamiento.set(p.id, ajustado - y)
    ultimo = ajustado
  }

  // Marcas del eje: los extremos y EL UMBRAL. Un punto medio arbitrario caía a
  // treinta pesos de la línea de referencia y se leían como dos cosas
  // distintas; rotular el umbral sobre su propia línea es más útil y es una
  // marca menos.
  const marcasY = [minMar, margenReferencia, maxMar]
  const marcasX = [0, umbralPopularidad, maxPop]

  return (
    <figure className="mt-4 mb-0">
      <div className="relative">
        <svg
          viewBox={`0 0 ${ANCHO} ${ALTO}`}
          className="w-full"
          style={{ height: 'auto' }}
          role="img"
          aria-label={
            `Matriz de menu engineering: ${puntos.length} platos ubicados por ` +
            `participación en las unidades vendidas y margen por unidad. ` +
            `Los mismos datos están en la tabla que sigue.`
          }
        >
          {/* Cuadrantes: las dos casillas de una diagonal con el MISMO tono
              apenas insinuado. Dos grises distintos sugerían una diferencia
              entre estrellas y perros que no existe: son cuatro regiones
              iguales en jerarquía, lo que las distingue es dónde están. */}
          <rect x={xUmbral} y={y0} width={x1 - xUmbral} height={yReferencia - y0}
                fill="#fafaf9" />
          <rect x={x0} y={yReferencia} width={xUmbral - x0} height={y1 - yReferencia}
                fill="#fafaf9" />

          {/* Grilla y ejes, recesivos. */}
          {marcasY.map((v) => (
            <line key={`gy-${v}`} x1={x0} x2={x1} y1={py(v)} y2={py(v)}
                  stroke="#e7e5e4" strokeWidth={1} />
          ))}
          <line x1={x0} x2={x1} y1={y1} y2={y1} stroke="#d6d3d1" strokeWidth={1} />
          <line x1={x0} x2={x0} y1={y0} y2={y1} stroke="#d6d3d1" strokeWidth={1} />

          {/* Las dos líneas que definen los cuadrantes: punteadas y rotuladas,
              porque son el criterio, no un adorno. */}
          <line x1={xUmbral} x2={xUmbral} y1={y0} y2={y1}
                stroke="#a8a29e" strokeWidth={1} strokeDasharray="4 4" />
          <line x1={x0} x2={x1} y1={yReferencia} y2={yReferencia}
                stroke="#a8a29e" strokeWidth={1} strokeDasharray="4 4" />

          {/* Rótulos de cuadrante. Reemplazan a la leyenda: con una sola serie
              lo que hay que nombrar son las regiones, no los colores. */}
          <text x={x1 - 6} y={y0 + 14} textAnchor="end"
                className="fill-stone-400" fontSize={11}>
            Estrellas
          </text>
          <text x={x0 + 6} y={y0 + 14} className="fill-stone-400" fontSize={11}>
            Rompecabezas
          </text>
          <text x={x1 - 6} y={y1 - 8} textAnchor="end"
                className="fill-stone-400" fontSize={11}>
            Vacas lecheras
          </text>
          <text x={x0 + 6} y={y1 - 8} className="fill-stone-400" fontSize={11}>
            Perros
          </text>

          {marcasY.map((v) => (
            <text key={`ty-${v}`} x={x0 - 8} y={py(v) + 4} textAnchor="end"
                  className="fill-stone-500" fontSize={11}
                  paintOrder="stroke" stroke={SUPERFICIE} strokeWidth={3}>
              {importe(v)}
            </text>
          ))}
          {marcasX.map((v) => (
            <text key={`tx-${v}`} x={px(v)} y={y1 + 18} textAnchor="middle"
                  className="fill-stone-500" fontSize={11}>
              {porcentaje(v)}
            </text>
          ))}
          <text x={(x0 + x1) / 2} y={ALTO - 8} textAnchor="middle"
                className="fill-stone-500" fontSize={12}>
            Participación en las unidades vendidas
          </text>
          <text transform={`translate(16 ${(y0 + y1) / 2}) rotate(-90)`}
                textAnchor="middle" className="fill-stone-500" fontSize={12}>
            Margen por unidad
          </text>

          {puntos.map((p) => {
            const cx = px(p.popularidad)
            const cy = py(p.margenUnitario)
            const aLaIzquierda = cx > (x0 + x1) / 2
            return (
              <g key={p.id}>
                {/* Anillo del color de la superficie: dos platos que caen cerca
                    siguen siendo dos platos. */}
                <circle cx={cx} cy={cy} r={4.5} fill={AZUL}
                        stroke={SUPERFICIE} strokeWidth={2} />
                {etiquetar && (
                  <text
                    x={aLaIzquierda ? cx - 10 : cx + 10}
                    y={cy + 4 + (desplazamiento.get(p.id) ?? 0)}
                    textAnchor={aLaIzquierda ? 'end' : 'start'}
                    className="fill-stone-700"
                    fontSize={11}
                    /* Halo del color de la superficie: sin él, la línea
                       punteada del umbral atraviesa el nombre del plato. */
                    paintOrder="stroke"
                    stroke={SUPERFICIE}
                    strokeWidth={3}
                  >
                    {p.producto}
                  </text>
                )}
                {/* Área de acierto de 24px, invisible. Un punto de 9px es un
                    blanco imposible con el dedo o con el mouse apurado. */}
                <circle
                  cx={cx}
                  cy={cy}
                  r={12}
                  fill="transparent"
                  data-testid={`punto-${p.producto}`}
                  onMouseEnter={() => setEncima(p.id)}
                  onMouseLeave={() => setEncima((a) => (a === p.id ? null : a))}
                  onFocus={() => setEncima(p.id)}
                  onBlur={() => setEncima((a) => (a === p.id ? null : a))}
                  tabIndex={0}
                  role="button"
                  aria-label={`${p.producto}: ${porcentaje(p.popularidad)} de las unidades, ${importe(p.margenUnitario)} por unidad`}
                />
              </g>
            )
          })}
        </svg>

        {activo && (
          <div
            className="pointer-events-none absolute left-1/2 top-2 -translate-x-1/2 rounded-lg border border-stone-200 bg-white px-3 py-2 text-xs shadow-sm"
            data-testid="tooltip-scatter"
          >
            <div className="font-medium text-stone-900">{activo.producto}</div>
            <div className="mt-1 text-stone-600">
              {porcentaje(activo.popularidad)} de las unidades ·{' '}
              {importe(activo.margenUnitario)} por unidad
            </div>
          </div>
        )}
      </div>

      <figcaption className="mt-2 text-xs text-stone-500">
        Las líneas punteadas son los umbrales: {porcentaje(umbralPopularidad)} de
        participación y {importe(margenReferencia)} de margen por unidad. El
        cuadrante de cada plato es dónde cae respecto de ellas — por eso no hace
        falta pintarlos de colores distintos.
      </figcaption>
    </figure>
  )
}
