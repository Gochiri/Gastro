import Link from 'next/link'
import { redirect } from 'next/navigation'
import { usuarioActual } from '@/lib/sesion'
import { listarImportaciones } from '@/consultas/ventas'

const ETIQUETA: Record<string, string> = {
  borrador: 'En revisión',
  confirmada: 'Confirmada',
  descartada: 'Descartada',
}

export default async function Ventas() {
  const usuario = await usuarioActual()
  if (!usuario) redirect('/login')

  const importaciones = await listarImportaciones(usuario)

  return (
    <>
      <div className="flex items-baseline justify-between">
        <h1 className="text-xl font-semibold tracking-tight">Importaciones</h1>
        <Link
          href="/ventas/importar"
          className="rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white"
        >
          Importar ventas
        </Link>
      </div>

      {importaciones.length === 0 ? (
        <p className="mt-6 rounded-lg border border-stone-200 bg-white p-6 text-sm text-stone-600">
          Todavía no importaste ningún archivo de ventas.
        </p>
      ) : (
        <table className="mt-6 w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-stone-300 text-left text-stone-500">
              <th className="pb-2 font-medium">Archivo</th>
              <th className="pb-2 font-medium">Estado</th>
              <th className="pb-2 text-right font-medium">Filas</th>
              <th className="pb-2 text-right font-medium">Fecha</th>
            </tr>
          </thead>
          <tbody>
            {importaciones.map((i) => (
              <tr key={i.id} className="border-b border-stone-200">
                <td className="py-2">
                  {i.estado === 'borrador' ? (
                    <Link href="/ventas/importar" className="font-medium underline">
                      {i.nombreArchivo}
                    </Link>
                  ) : (
                    i.nombreArchivo
                  )}
                </td>
                <td className="py-2 text-stone-600">{ETIQUETA[i.estado]}</td>
                <td className="py-2 text-right tabular-nums text-stone-600">
                  {i.filasOk} / {i.filasTotal}
                </td>
                <td className="py-2 text-right tabular-nums text-stone-500">
                  {new Date(i.creadaEn).toLocaleDateString('es-AR')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  )
}
