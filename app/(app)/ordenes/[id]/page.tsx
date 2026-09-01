import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { usuarioActual } from '@/lib/sesion'
import { organizacionActiva } from '@/consultas/recetas'
import { obtenerOrden } from '@/consultas/ordenes'
import { insumosParaSelector } from '@/consultas/inventario'
import { formatearCantidad } from '@/lib/formato'
import { agregarItem, enviarOrden, recibir } from '../acciones'

export default async function Orden({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const usuario = await usuarioActual()
  if (!usuario) redirect('/login')

  const [organizacion, orden, insumos] = await Promise.all([
    organizacionActiva(usuario),
    obtenerOrden(usuario, id),
    insumosParaSelector(usuario),
  ])
  if (!organizacion) redirect('/login')
  if (!orden) notFound()

  const cant = (v: number): string => formatearCantidad(v, organizacion.pais)
  const editable = orden.estado === 'borrador'
  const recibible = orden.estado === 'enviada' || orden.estado === 'parcial'

  return (
    <>
      <h1 className="text-xl font-semibold tracking-tight">
        Orden a {orden.proveedor}
      </h1>
      <p className="mt-1 text-sm text-stone-600">
        {orden.fecha} · {orden.estado === 'parcial' ? 'recibida en parte' : orden.estado}
      </p>

      {editable && (
        <form action={agregarItem} className="mt-6 flex flex-wrap items-end gap-2">
          <input type="hidden" name="ordenId" value={orden.id} />
          <label className="flex flex-1 flex-col">
            <span className="text-xs text-stone-500">Insumo</span>
            <select
              name="insumoId"
              required
              defaultValue=""
              data-testid="orden-insumo"
              className="mt-1 rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm"
            >
              <option value="" disabled>
                Elegir…
              </option>
              {insumos.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.nombre} ({i.unidadBase})
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col">
            <span className="text-xs text-stone-500">Cantidad</span>
            <input
              type="number"
              name="cantidad"
              step="any"
              min="0"
              required
              data-testid="orden-cantidad"
              className="mt-1 w-28 rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm"
            />
          </label>
          <button
            type="submit"
            className="rounded-lg border border-stone-300 bg-white px-4 py-2 text-sm font-medium hover:border-stone-500"
          >
            Agregar
          </button>
        </form>
      )}

      <table className="mt-6 w-full border-collapse text-sm" data-testid="avance">
        <thead>
          <tr className="border-b border-stone-300 text-left text-stone-500">
            <th className="pb-2 font-medium">Insumo</th>
            <th className="pb-2 text-right font-medium">Pedido</th>
            <th className="pb-2 text-right font-medium">Recibido</th>
            <th className="pb-2 text-right font-medium">Falta</th>
          </tr>
        </thead>
        <tbody>
          {orden.avance.map((a) => {
            const falta = Math.max(a.pedido - a.recibido, 0)
            return (
              <tr key={a.ordenItemId} className="border-b border-stone-200">
                <td className="py-2 font-medium">{a.insumo}</td>
                <td className="py-2 text-right tabular-nums text-stone-600">
                  {cant(a.pedido)} {a.unidadBase}
                </td>
                <td className="py-2 text-right tabular-nums text-stone-600">
                  {cant(a.recibido)} {a.unidadBase}
                </td>
                <td
                  className={`py-2 text-right tabular-nums ${falta > 0 ? 'font-medium' : 'text-stone-400'}`}
                >
                  {falta > 0 ? `${cant(falta)} ${a.unidadBase}` : '—'}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>

      {editable && orden.avance.length > 0 && (
        <form action={enviarOrden} className="mt-6">
          <input type="hidden" name="ordenId" value={orden.id} />
          <button
            type="submit"
            data-testid="enviar-orden"
            className="rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white"
          >
            Marcar como enviada
          </button>
        </form>
      )}

      {recibible && (
        <form action={recibir} className="mt-8 rounded-lg border border-stone-200 bg-white p-4">
          <input type="hidden" name="ordenId" value={orden.id} />
          <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500">
            Registrar recepción
          </h2>
          <label className="mt-3 flex w-48 flex-col">
            <span className="text-xs text-stone-500">Fecha</span>
            <input
              type="date"
              name="fecha"
              required
              data-testid="recepcion-fecha"
              className="mt-1 rounded-lg border border-stone-300 px-3 py-2 text-sm"
            />
          </label>

          <table className="mt-4 w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-stone-300 text-left text-stone-500">
                <th className="pb-2 font-medium">Insumo</th>
                <th className="pb-2 font-medium">Cantidad recibida</th>
                <th className="pb-2 font-medium">Costo total</th>
              </tr>
            </thead>
            <tbody>
              {orden.avance
                .filter((a) => a.recibido < a.pedido - 0.0001)
                .map((a) => (
                  <tr key={a.ordenItemId} className="border-b border-stone-200">
                    <td className="py-2">
                      {a.insumo}{' '}
                      <span className="text-xs text-stone-500">({a.unidadBase})</span>
                    </td>
                    <td className="py-2">
                      <input
                        type="number"
                        name={`cantidad-${a.ordenItemId}`}
                        step="any"
                        min="0"
                        data-testid={`recibir-cantidad-${a.insumo}`}
                        className="w-32 rounded-lg border border-stone-300 px-2 py-1 text-sm"
                      />
                    </td>
                    <td className="py-2">
                      <input
                        type="number"
                        name={`costo-${a.ordenItemId}`}
                        step="any"
                        min="0"
                        data-testid={`recibir-costo-${a.insumo}`}
                        className="w-32 rounded-lg border border-stone-300 px-2 py-1 text-sm"
                      />
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>

          <label className="mt-4 flex items-start gap-2 text-sm text-stone-700">
            <input
              type="checkbox"
              name="actualizaPrecios"
              data-testid="actualiza-precios"
              className="mt-0.5"
            />
            <span>
              Actualizar el precio de referencia de estos insumos con lo que se
              pagó.{' '}
              <span className="text-stone-500">
                Recostea todas las recetas que los usen: dejalo sin marcar si fue
                una compra de urgencia a precio atípico.
              </span>
            </span>
          </label>

          <button
            type="submit"
            data-testid="confirmar-recepcion"
            className="mt-4 rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white"
          >
            Confirmar recepción
          </button>
        </form>
      )}

      <p className="mt-8 text-sm">
        <Link href="/ordenes" className="text-stone-500 hover:text-stone-900">
          ← Órdenes
        </Link>
      </p>
    </>
  )
}
