import { redirect } from 'next/navigation'
import { usuarioActual } from '@/lib/sesion'
import { organizacionActiva } from '@/consultas/recetas'
import { insumosParaSelector, listarCompras } from '@/consultas/inventario'
import { formatearCantidad, formatearImporte } from '@/lib/formato'
import { registrarCompra } from '../inventario/acciones'

export default async function Compras() {
  const usuario = await usuarioActual()
  if (!usuario) redirect('/login')

  const [organizacion, compras, insumos] = await Promise.all([
    organizacionActiva(usuario),
    listarCompras(usuario),
    insumosParaSelector(usuario),
  ])
  if (!organizacion) redirect('/login')

  return (
    <>
      <h1 className="text-xl font-semibold tracking-tight">Compras</h1>
      <p className="mt-1 text-sm text-stone-600">
        Lo que entró a la despensa. Sin esto no se puede calcular cuánto se
        consumió realmente.
      </p>

      <form action={registrarCompra} className="mt-6 flex flex-wrap items-end gap-2">
        <label className="flex flex-col">
          <span className="text-xs text-stone-500">Fecha</span>
          <input
            type="date"
            name="fecha"
            required
            data-testid="compra-fecha"
            className="mt-1 rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm"
          />
        </label>
        <label className="flex flex-1 flex-col">
          <span className="text-xs text-stone-500">Insumo</span>
          <select
            name="insumoId"
            required
            defaultValue=""
            data-testid="compra-insumo"
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
            data-testid="compra-cantidad"
            className="mt-1 w-28 rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm"
          />
        </label>
        <label className="flex flex-col">
          <span className="text-xs text-stone-500">Costo total</span>
          <input
            type="number"
            name="costoTotal"
            step="any"
            min="0"
            required
            data-testid="compra-costo"
            className="mt-1 w-32 rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm"
          />
        </label>
        <button
          type="submit"
          className="rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white"
        >
          Registrar
        </button>
      </form>

      <p className="mt-3 text-xs text-stone-500">
        Registrar una compra no cambia el precio de referencia del insumo: una
        compra de urgencia más cara no debería recostear todo el menú.
      </p>

      <table className="mt-6 w-full border-collapse text-sm" data-testid="tabla-compras">
        <thead>
          <tr className="border-b border-stone-300 text-left text-stone-500">
            <th className="pb-2 font-medium">Fecha</th>
            <th className="pb-2 font-medium">Insumo</th>
            <th className="pb-2 text-right font-medium">Cantidad</th>
            <th className="pb-2 text-right font-medium">Costo</th>
          </tr>
        </thead>
        <tbody>
          {compras.map((c) => (
            <tr key={c.id} className="border-b border-stone-200">
              <td className="py-2 text-stone-600">{c.fecha}</td>
              <td className="py-2">{c.insumo}</td>
              <td className="py-2 text-right tabular-nums text-stone-600">
                {formatearCantidad(c.cantidad, organizacion.pais)} {c.unidad}
              </td>
              <td className="py-2 text-right tabular-nums">
                {formatearImporte(c.costoTotal, organizacion.moneda, organizacion.pais)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  )
}
