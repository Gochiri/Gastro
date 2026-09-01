import Link from 'next/link'
import { redirect } from 'next/navigation'
import { usuarioActual } from '@/lib/sesion'
import { listarConteos, ultimoParCerrado } from '@/consultas/inventario'
import { crearConteo } from './acciones'

const TIPO: Record<string, string> = {
  apertura: 'Apertura',
  cierre: 'Cierre',
  ciclico: 'Cíclico',
}

export default async function Inventario() {
  const usuario = await usuarioActual()
  if (!usuario) redirect('/login')

  const [conteos, par] = await Promise.all([
    listarConteos(usuario),
    ultimoParCerrado(usuario),
  ])

  return (
    <>
      <div className="flex items-baseline justify-between">
        <h1 className="text-xl font-semibold tracking-tight">Conteos de inventario</h1>
        <form action={crearConteo}>
          <input type="hidden" name="tipo" value="ciclico" />
          <button
            type="submit"
            data-testid="nuevo-conteo"
            className="rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white"
          >
            Nuevo conteo
          </button>
        </form>
      </div>
      <p className="mt-1 text-sm text-stone-600">
        No hace falta contar todo. Contá lo que importa —carnes, quesos— y el
        informe te dirá qué parte del costo está cubriendo.{' '}
        <Link href="/inventario/stock" className="font-medium text-stone-900 underline">
          Ver stock teórico y movimientos
        </Link>
      </p>

      {par && (
        <p className="mt-4">
          <Link
            href="/inventario/varianza"
            data-testid="ver-varianza"
            className="text-sm font-medium text-stone-900 underline"
          >
            Ver varianza entre los dos últimos conteos cerrados →
          </Link>
        </p>
      )}

      {conteos.length === 0 ? (
        <p className="mt-6 rounded-lg border border-stone-200 bg-white p-6 text-sm text-stone-600">
          Todavía no hiciste ningún conteo. Hacen falta dos conteos cerrados para
          calcular la varianza.
        </p>
      ) : (
        <table className="mt-6 w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-stone-300 text-left text-stone-500">
              <th className="pb-2 font-medium">Momento</th>
              <th className="pb-2 font-medium">Tipo</th>
              <th className="pb-2 font-medium">Estado</th>
              <th className="pb-2 text-right font-medium">Insumos</th>
            </tr>
          </thead>
          <tbody>
            {conteos.map((c) => (
              <tr key={c.id} className="border-b border-stone-200">
                <td className="py-2">
                  <Link href={`/inventario/${c.id}`} className="font-medium underline">
                    {new Date(c.momento).toLocaleString('es-AR', {
                      dateStyle: 'short',
                      timeStyle: 'short',
                    })}
                  </Link>
                </td>
                <td className="py-2 text-stone-600">{TIPO[c.tipo]}</td>
                <td className="py-2 text-stone-600">
                  {c.estado === 'cerrado' ? 'Cerrado' : 'En borrador'}
                </td>
                <td className="py-2 text-right tabular-nums text-stone-600">{c.items}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  )
}
