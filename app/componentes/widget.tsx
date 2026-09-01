'use client'

/**
 * Piezas compartidas por los paneles de IA.
 *
 * La advertencia de cifras sin respaldo vive acá y no en cada widget a
 * propósito: es la garantía del producto, y no puede depender de que quien
 * escriba el próximo widget se acuerde de ponerla.
 */

export function AvisoCifras({
  cifras,
  proposito = 'analisis',
}: {
  cifras?: number[]
  /**
   * Una cifra sin respaldo no significa lo mismo en todos lados. En un widget
   * analítico es un error de cálculo y hay que desconfiar del número. En una
   * pieza de redes es una afirmación que el negocio va a publicar bajo su
   * propio nombre: no está mal por ser inverificable, pero hay que verificarla.
   */
  proposito?: 'analisis' | 'publicacion'
}) {
  if (!cifras || cifras.length === 0) return null
  return (
    <p
      className="mb-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900"
      data-testid="aviso-cifras"
    >
      {proposito === 'publicacion' ? (
        <>
          Estas cifras no salen de tus datos ({cifras.join(', ')}). Pueden ser
          ciertas —el sistema no sabe cuántas horas fermenta tu masa— pero las
          vas a publicar vos: verificá cada una antes de que salga.
        </>
      ) : (
        <>
          Esta respuesta menciona cifras que no están en tus datos ({cifras.join(', ')}).
          Tomala con reservas y contrastá contra las tablas de esta pantalla.
        </>
      )}
    </p>
  )
}

export function ErrorWidget({ mensaje }: { mensaje?: string }) {
  if (!mensaje) return null
  return (
    <p
      className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900"
      data-testid="error-ia"
    >
      {mensaje}
    </p>
  )
}

export function BotonGenerar({
  pendiente,
  etiqueta,
  etiquetaPendiente = 'Pensando…',
  testid,
}: {
  pendiente: boolean
  etiqueta: string
  etiquetaPendiente?: string
  testid: string
}) {
  return (
    <button
      type="submit"
      disabled={pendiente}
      data-testid={testid}
      className="rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
    >
      {pendiente ? etiquetaPendiente : etiqueta}
    </button>
  )
}
