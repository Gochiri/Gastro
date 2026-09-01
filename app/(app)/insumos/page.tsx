import { redirect } from 'next/navigation'
import { usuarioActual } from '@/lib/sesion'
import { organizacionActiva } from '@/consultas/recetas'
import { listarInsumos } from '@/consultas/insumos'
import { formatearImporte, formatearPorcentaje } from '@/lib/formato'

export default async function Insumos() {
  const usuario = await usuarioActual()
  if (!usuario) redirect('/login')

  const [organizacion, insumos] = await Promise.all([
    organizacionActiva(usuario),
    listarInsumos(usuario),
  ])
  if (!organizacion) redirect('/login')

  return (
    <>
      <h1 className="text-xl font-semibold tracking-tight">Insumos</h1>
      <p className="mt-1 text-sm text-stone-600">
        Precio por unidad base, calculado desde la presentación de compra vigente.
      </p>

      <table className="mt-6 w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-stone-300 text-left text-stone-500">
            <th className="pb-2 font-medium">Insumo</th>
            <th className="pb-2 font-medium">Categoría</th>
            <th className="pb-2 text-right font-medium">Merma</th>
            <th className="pb-2 text-right font-medium">Precio unitario</th>
          </tr>
        </thead>
        <tbody>
          {insumos.map((i) => (
            <tr key={i.id} className="border-b border-stone-200">
              <td className="py-2 font-medium">{i.nombre}</td>
              <td className="py-2 text-stone-600">{i.categoria ?? '—'}</td>
              <td className="py-2 text-right tabular-nums text-stone-600">
                {i.mermaPct > 0 ? formatearPorcentaje(i.mermaPct, organizacion.pais) : '—'}
              </td>
              <td className="py-2 text-right tabular-nums">
                {i.precioUnitario === null
                  ? <span className="text-stone-400">sin precio</span>
                  : `${formatearImporte(i.precioUnitario, organizacion.moneda, organizacion.pais, 4)} / ${i.unidadBase}`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  )
}
