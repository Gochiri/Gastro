import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { usuarioActual } from '@/lib/sesion'
import { insumosParaSelector, obtenerConteo } from '@/consultas/inventario'
import { formatearCantidad } from '@/lib/formato'
import { organizacionActiva } from '@/consultas/recetas'
import { agregarItem, cerrar, quitarItem } from '../acciones'

export default async function Conteo({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const usuario = await usuarioActual()
  if (!usuario) redirect('/login')

  const [organizacion, conteo, insumos] = await Promise.all([
    organizacionActiva(usuario),
    obtenerConteo(usuario, id),
    insumosParaSelector(usuario),
  ])
  if (!organizacion) redirect('/login')
  if (!conteo) notFound()

  const abierto = conteo.estado === 'borrador'

  return (
    <>
      <h1 className="text-xl font-semibold tracking-tight">
        Conteo del{' '}
        {new Date(conteo.momento).toLocaleString('es-AR', {
          dateStyle: 'short',
          timeStyle: 'short',
        })}
      </h1>
      <p className="mt-1 text-sm text-stone-600">
        {abierto ? 'En borrador: todavía se puede editar.' : 'Cerrado. Los valores quedaron congelados.'}
      </p>

      {abierto && (
        <form action={agregarItem} className="mt-6 flex flex-wrap gap-2">
          <input type="hidden" name="conteoId" value={conteo.id} />
          <select
            name="insumoId"
            required
            data-testid="insumo"
            className="flex-1 rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm"
            defaultValue=""
          >
            <option value="" disabled>
              Elegir insumo…
            </option>
            {insumos.map((i) => (
              <option key={i.id} value={i.id}>
                {i.nombre} ({i.unidadBase})
              </option>
            ))}
          </select>
          <input
            type="number"
            name="cantidad"
            step="any"
            min="0"
            required
            placeholder="Cantidad"
            data-testid="cantidad"
            className="w-32 rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm"
          />
          <button
            type="submit"
            className="rounded-lg border border-stone-300 bg-white px-4 py-2 text-sm font-medium hover:border-stone-500"
          >
            Agregar
          </button>
        </form>
      )}

      <table className="mt-6 w-full border-collapse text-sm" data-testid="items">
        <thead>
          <tr className="border-b border-stone-300 text-left text-stone-500">
            <th className="pb-2 font-medium">Insumo</th>
            <th className="pb-2 text-right font-medium">Cantidad</th>
            {abierto && <th className="pb-2" />}
          </tr>
        </thead>
        <tbody>
          {conteo.items_detalle.map((i) => (
            <tr key={i.id} className="border-b border-stone-200">
              <td className="py-2">{i.insumo}</td>
              <td className="py-2 text-right tabular-nums">
                {formatearCantidad(i.cantidad, organizacion.pais)} {i.unidad}
              </td>
              {abierto && (
                <td className="py-2 text-right">
                  <form action={quitarItem}>
                    <input type="hidden" name="itemId" value={i.id} />
                    <input type="hidden" name="conteoId" value={conteo.id} />
                    <button type="submit" className="text-xs text-stone-500 hover:text-stone-900">
                      Quitar
                    </button>
                  </form>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>

      {abierto && conteo.items_detalle.length > 0 && (
        <form action={cerrar} className="mt-8">
          <input type="hidden" name="conteoId" value={conteo.id} />
          <button
            type="submit"
            data-testid="cerrar-conteo"
            className="rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white"
          >
            Cerrar conteo
          </button>
          <span className="ml-3 text-sm text-stone-500">
            Al cerrar, las cantidades quedan valuadas con los precios de hoy y ya no se editan.
          </span>
        </form>
      )}

      <p className="mt-8 text-sm">
        <Link href="/inventario" className="text-stone-500 hover:text-stone-900">
          ← Conteos
        </Link>
      </p>
    </>
  )
}
