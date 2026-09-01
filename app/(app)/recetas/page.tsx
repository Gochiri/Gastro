import Link from 'next/link'
import { redirect } from 'next/navigation'
import { usuarioActual } from '@/lib/sesion'
import { listarRecetas, organizacionActiva } from '@/consultas/recetas'
import { formatearCantidad, formatearImporte } from '@/lib/formato'

export default async function Recetas() {
  const usuario = await usuarioActual()
  if (!usuario) redirect('/login')

  const [organizacion, recetas] = await Promise.all([
    organizacionActiva(usuario),
    listarRecetas(usuario),
  ])
  if (!organizacion) redirect('/login')

  const importe = (valor: number): string =>
    formatearImporte(valor, organizacion.moneda, organizacion.pais)

  return (
    <>
      <h1 className="text-xl font-semibold tracking-tight">Fichas técnicas</h1>
      <p className="mt-1 text-sm text-stone-600">
        Costo calculado con los precios vigentes hoy. Las subrecetas se costean
        dentro de los platos que las usan.
      </p>

      <table className="mt-6 w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-stone-300 text-left text-stone-500">
            <th className="pb-2 font-medium">Receta</th>
            <th className="pb-2 font-medium">Rinde</th>
            <th className="pb-2 text-right font-medium">Costo elaboración</th>
            <th className="pb-2 text-right font-medium">Costo unitario</th>
          </tr>
        </thead>
        <tbody>
          {recetas.map((r) => (
            <tr key={r.id} className="border-b border-stone-200">
              <td className="py-2">
                <Link
                  href={`/recetas/${r.id}`}
                  className="font-medium text-stone-900 hover:underline"
                >
                  {r.nombre}
                </Link>
                {r.tipo === 'subreceta' && (
                  <span className="ml-2 rounded bg-stone-200 px-1.5 py-0.5 text-xs text-stone-600">
                    subreceta
                  </span>
                )}
              </td>
              <td className="py-2 text-stone-600">
                {formatearCantidad(r.rendimientoCantidad, organizacion.pais)} {r.rendimientoUnidad}
              </td>
              <td className="py-2 text-right tabular-nums">{importe(r.costoTotal)}</td>
              <td
                className="py-2 text-right font-medium tabular-nums"
                data-testid={`costo-unitario-${r.nombre}`}
              >
                {importe(r.costoUnitario)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  )
}
