import Link from 'next/link'
import { redirect } from 'next/navigation'
import { usuarioActual } from '@/lib/sesion'
import { organizacionActiva } from '@/consultas/recetas'
import { salir } from '../login/acciones'

export default async function LayoutApp({ children }: { children: React.ReactNode }) {
  const usuario = await usuarioActual()
  if (!usuario) redirect('/login')

  const organizacion = await organizacionActiva(usuario)
  if (!organizacion) redirect('/login')

  return (
    <div className="min-h-screen">
      <header className="border-b border-stone-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center gap-6 px-6 py-4">
          <span className="font-semibold" data-testid="organizacion">
            {organizacion.nombre}
          </span>
          <nav className="flex gap-4 text-sm">
            <Link href="/recetas" className="text-stone-600 hover:text-stone-900">
              Recetas
            </Link>
            <Link href="/insumos" className="text-stone-600 hover:text-stone-900">
              Insumos
            </Link>
            <Link href="/ventas" className="text-stone-600 hover:text-stone-900">
              Ventas
            </Link>
            <Link href="/compras" className="text-stone-600 hover:text-stone-900">
              Compras
            </Link>
            <Link href="/inventario" className="text-stone-600 hover:text-stone-900">
              Inventario
            </Link>
            <Link href="/mermas" className="text-stone-600 hover:text-stone-900">
              Mermas
            </Link>
            <Link href="/dashboard" className="text-stone-600 hover:text-stone-900">
              Resultados
            </Link>
          </nav>
          <form action={salir} className="ml-auto">
            <button type="submit" className="text-sm text-stone-500 hover:text-stone-900">
              Salir
            </button>
          </form>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-6 py-8">{children}</main>
    </div>
  )
}
