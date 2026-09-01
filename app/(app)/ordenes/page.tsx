import Link from 'next/link'
import { redirect } from 'next/navigation'
import { usuarioActual } from '@/lib/sesion'
import { listarOrdenes, listarProveedores } from '@/consultas/ordenes'
import { crearOrden } from './acciones'

const ESTADO: Record<string, string> = {
  borrador: 'Borrador',
  enviada: 'Enviada',
  parcial: 'Recibida en parte',
  recibida: 'Recibida',
  cancelada: 'Cancelada',
}

export default async function Ordenes() {
  const usuario = await usuarioActual()
  if (!usuario) redirect('/login')

  const [ordenes, proveedores] = await Promise.all([
    listarOrdenes(usuario),
    listarProveedores(usuario),
  ])

  return (
    <>
      <h1 className="text-xl font-semibold tracking-tight">Órdenes de compra</h1>
      <p className="mt-1 text-sm text-stone-600">
        Al recibir mercadería se genera la compra que alimenta el cálculo de
        consumo real. La lista de precios solo se actualiza si lo pedís.
      </p>

      <form action={crearOrden} className="mt-6 flex flex-wrap items-end gap-2">
        <label className="flex flex-1 flex-col">
          <span className="text-xs text-stone-500">Proveedor</span>
          <select
            name="proveedorId"
            required
            defaultValue=""
            data-testid="orden-proveedor"
            className="mt-1 rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm"
          >
            <option value="" disabled>
              Elegir…
            </option>
            {proveedores.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nombre}
              </option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          data-testid="nueva-orden"
          className="rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white"
        >
          Nueva orden
        </button>
      </form>

      <table className="mt-6 w-full border-collapse text-sm" data-testid="tabla-ordenes">
        <thead>
          <tr className="border-b border-stone-300 text-left text-stone-500">
            <th className="pb-2 font-medium">Fecha</th>
            <th className="pb-2 font-medium">Proveedor</th>
            <th className="pb-2 font-medium">Estado</th>
            <th className="pb-2 text-right font-medium">Ítems</th>
          </tr>
        </thead>
        <tbody>
          {ordenes.map((o) => (
            <tr key={o.id} className="border-b border-stone-200">
              <td className="py-2">
                <Link href={`/ordenes/${o.id}`} className="font-medium underline">
                  {o.fecha}
                </Link>
              </td>
              <td className="py-2">{o.proveedor}</td>
              <td className="py-2 text-stone-600">
                {ESTADO[o.estado]}
                {o.estado === 'parcial' && ` · faltan ${o.pendientes}`}
              </td>
              <td className="py-2 text-right tabular-nums text-stone-600">{o.items}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  )
}
