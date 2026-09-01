/**
 * Piezas de presentación del dashboard.
 *
 * Siguen las reglas de la skill `dataviz`:
 * - Una sola cifra protagonista por vista (>=48px).
 * - Las tarjetas usan figuras proporcionales; `tabular-nums` se reserva para
 *   columnas de tabla, donde los dígitos deben alinearse verticalmente.
 * - Una sola serie no lleva leyenda: el título ya la nombra.
 * - El texto va con tokens de texto, nunca con el color de la serie.
 */

const AZUL = '#2a78d6' // hue secuencial por defecto de la paleta

export function CifraPrincipal({
  etiqueta,
  valor,
  nota,
}: {
  etiqueta: string
  valor: string
  nota?: string
}) {
  return (
    <div className="rounded-lg border border-stone-200 bg-white p-6">
      <div className="text-xs uppercase tracking-wide text-stone-500">{etiqueta}</div>
      <div className="mt-1 text-5xl font-semibold text-stone-900" data-testid="cifra-principal">
        {valor}
      </div>
      {nota && <div className="mt-2 text-sm text-stone-600">{nota}</div>}
    </div>
  )
}

export function Tarjeta({
  etiqueta,
  valor,
  nota,
  testid,
}: {
  etiqueta: string
  valor: string
  nota?: string
  testid?: string
}) {
  return (
    <div className="rounded-lg border border-stone-200 bg-white p-4">
      <div className="text-xs uppercase tracking-wide text-stone-500">{etiqueta}</div>
      <div className="mt-1 text-2xl font-semibold text-stone-900" data-testid={testid}>
        {valor}
      </div>
      {nota && <div className="mt-1 text-xs text-stone-500">{nota}</div>}
    </div>
  )
}

export interface Barra {
  etiqueta: string
  valor: number
  texto: string
}

/**
 * Barras horizontales de una sola serie.
 *
 * Un solo tono (magnitud, no identidad), etiquetas directas en cada barra y
 * extremo redondeado de 4px anclado a la línea base. Sin leyenda: con una serie
 * sobra, el título la nombra.
 */
export function BarrasHorizontales({
  titulo,
  descripcion,
  datos,
}: {
  titulo: string
  descripcion?: string
  datos: Barra[]
}) {
  const maximo = Math.max(...datos.map((d) => Math.abs(d.valor)), 1)

  return (
    <section>
      <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500">{titulo}</h2>
      {descripcion && <p className="mt-1 text-sm text-stone-600">{descripcion}</p>}
      <ul className="mt-4 space-y-3">
        {datos.map((d) => (
          <li key={d.etiqueta} className="grid grid-cols-[9rem_1fr_auto] items-center gap-3">
            <span className="truncate text-sm text-stone-700">{d.etiqueta}</span>
            <span className="h-5 rounded-r bg-stone-100" aria-hidden>
              <span
                className="block h-5 rounded-r"
                style={{
                  width: `${Math.max((Math.abs(d.valor) / maximo) * 100, 1.5)}%`,
                  backgroundColor: AZUL,
                }}
              />
            </span>
            <span className="text-sm font-medium tabular-nums text-stone-900">{d.texto}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}
