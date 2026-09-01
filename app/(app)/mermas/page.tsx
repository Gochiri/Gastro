import { redirect } from 'next/navigation'
import { usuarioActual } from '@/lib/sesion'
import { organizacionActiva } from '@/consultas/recetas'
import { insumosParaSelector, listarMermas } from '@/consultas/inventario'
import { formatearCantidad, formatearImporte } from '@/lib/formato'
import { registrarMerma } from '../inventario/acciones'

const MOTIVOS: Record<string, string> = {
  vencimiento: 'Vencimiento',
  error_cocina: 'Error de cocina',
  cortesia: 'Cortesía',
  rotura: 'Rotura',
  devolucion: 'Devolución',
  otro: 'Otro',
}

export default async function Mermas() {
  const usuario = await usuarioActual()
  if (!usuario) redirect('/login')

  const [organizacion, mermas, insumos] = await Promise.all([
    organizacionActiva(usuario),
    listarMermas(usuario),
    insumosParaSelector(usuario),
  ])
  if (!organizacion) redirect('/login')

  return (
    <>
      <h1 className="text-xl font-semibold tracking-tight">Mermas</h1>
      <p className="mt-1 text-sm text-stone-600">
        Lo que se tiró y por qué. Cada merma anotada es una parte del desvío que
        deja de parecer robo.
      </p>

      <form action={registrarMerma} className="mt-6 flex flex-wrap items-end gap-2">
        <label className="flex flex-col">
          <span className="text-xs text-stone-500">Fecha</span>
          <input
            type="date"
            name="fecha"
            required
            data-testid="merma-fecha"
            className="mt-1 rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm"
          />
        </label>
        <label className="flex flex-1 flex-col">
          <span className="text-xs text-stone-500">Insumo</span>
          <select
            name="insumoId"
            required
            defaultValue=""
            data-testid="merma-insumo"
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
            data-testid="merma-cantidad"
            className="mt-1 w-28 rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm"
          />
        </label>
        <label className="flex flex-col">
          <span className="text-xs text-stone-500">Motivo</span>
          <select
            name="motivo"
            defaultValue="error_cocina"
            data-testid="merma-motivo"
            className="mt-1 rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm"
          >
            {Object.entries(MOTIVOS).map(([valor, texto]) => (
              <option key={valor} value={valor}>
                {texto}
              </option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          className="rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white"
        >
          Registrar
        </button>
      </form>

      <table className="mt-6 w-full border-collapse text-sm" data-testid="tabla-mermas">
        <thead>
          <tr className="border-b border-stone-300 text-left text-stone-500">
            <th className="pb-2 font-medium">Fecha</th>
            <th className="pb-2 font-medium">Insumo</th>
            <th className="pb-2 font-medium">Motivo</th>
            <th className="pb-2 text-right font-medium">Cantidad</th>
            <th className="pb-2 text-right font-medium">Costo</th>
          </tr>
        </thead>
        <tbody>
          {mermas.map((m) => (
            <tr key={m.id} className="border-b border-stone-200">
              <td className="py-2 text-stone-600">{m.fecha}</td>
              <td className="py-2">{m.insumo}</td>
              <td className="py-2 text-stone-600">{MOTIVOS[m.motivo] ?? m.motivo}</td>
              <td className="py-2 text-right tabular-nums text-stone-600">
                {formatearCantidad(m.cantidad, organizacion.pais)} {m.unidad}
              </td>
              <td className="py-2 text-right tabular-nums">
                {m.costo === null
                  ? '—'
                  : formatearImporte(m.costo, organizacion.moneda, organizacion.pais)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  )
}
