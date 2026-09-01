import { notFound, redirect } from 'next/navigation'
import { usuarioActual } from '@/lib/sesion'
import { obtenerReceta, organizacionActiva } from '@/consultas/recetas'
import { formatearCantidad, formatearImporte, formatearPorcentaje } from '@/lib/formato'

// En Next.js 16 los params son una promesa.
export default async function FichaTecnica({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const usuario = await usuarioActual()
  if (!usuario) redirect('/login')

  const [organizacion, receta] = await Promise.all([
    organizacionActiva(usuario),
    obtenerReceta(usuario, id),
  ])
  if (!organizacion) redirect('/login')

  // RLS no distingue "no existe" de "es de otra organización", y está bien:
  // un 404 no debe revelar que el recurso existe en otra cuenta.
  if (!receta) notFound()

  const importe = (valor: number, decimales = 2): string =>
    formatearImporte(valor, organizacion.moneda, organizacion.pais, decimales)

  return (
    <>
      <h1 className="text-xl font-semibold tracking-tight">{receta.nombre}</h1>
      <p className="mt-1 text-sm text-stone-600">
        Rinde {formatearCantidad(receta.rendimientoCantidad, organizacion.pais)}{' '}
        {receta.rendimientoUnidad}
      </p>

      <div className="mt-6 grid grid-cols-2 gap-4">
        <div className="rounded-lg border border-stone-200 bg-white p-4">
          <div className="text-xs uppercase tracking-wide text-stone-500">
            Costo de la elaboración
          </div>
          <div className="mt-1 text-2xl font-semibold tabular-nums" data-testid="costo-total">
            {importe(receta.costoTotal)}
          </div>
        </div>
        <div className="rounded-lg border border-stone-200 bg-white p-4">
          <div className="text-xs uppercase tracking-wide text-stone-500">
            Costo por {receta.rendimientoUnidad === 'u' ? 'porción' : receta.rendimientoUnidad}
          </div>
          <div className="mt-1 text-2xl font-semibold tabular-nums" data-testid="costo-unitario">
            {importe(receta.costoUnitario)}
          </div>
        </div>
      </div>

      <h2 className="mt-8 text-sm font-semibold uppercase tracking-wide text-stone-500">
        Desglose por insumo
      </h2>
      <p className="mt-1 text-sm text-stone-600">
        Cantidades brutas: incluyen la merma de limpieza de cada insumo. Las
        subrecetas están explotadas hasta sus ingredientes.
      </p>

      <table className="mt-4 w-full border-collapse text-sm" data-testid="desglose">
        <thead>
          <tr className="border-b border-stone-300 text-left text-stone-500">
            <th className="pb-2 font-medium">Insumo</th>
            <th className="pb-2 text-right font-medium">Cantidad bruta</th>
            <th className="pb-2 text-right font-medium">Precio unitario</th>
            <th className="pb-2 text-right font-medium">Costo</th>
            <th className="pb-2 text-right font-medium">%</th>
          </tr>
        </thead>
        <tbody>
          {receta.desglose.map((linea) => (
            <tr key={linea.insumo} className="border-b border-stone-200">
              <td className="py-2">{linea.insumo}</td>
              <td className="py-2 text-right tabular-nums text-stone-600">
                {formatearCantidad(linea.cantidadBruta, organizacion.pais)} {linea.unidad}
              </td>
              <td className="py-2 text-right tabular-nums text-stone-600">
                {importe(linea.precioUnitario, 4)}
              </td>
              <td className="py-2 text-right tabular-nums">{importe(linea.costo)}</td>
              <td className="py-2 text-right tabular-nums text-stone-500">
                {formatearPorcentaje(linea.pctDelTotal, organizacion.pais)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  )
}
