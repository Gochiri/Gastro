import Link from 'next/link'

const SECCIONES = [
  { href: '/finanzas', etiqueta: 'Resultado' },
  { href: '/finanzas/gastos', etiqueta: 'Gastos fijos' },
  { href: '/finanzas/fiscal', etiqueta: 'IVA y retenciones' },
  { href: '/finanzas/sucursales', etiqueta: 'Sucursales' },
]

export function NavFinanzas({ activa }: { activa: string }) {
  return (
    <nav className="mt-4 flex gap-4 border-b border-stone-200 text-sm">
      {SECCIONES.map((s) => (
        <Link
          key={s.href}
          href={s.href}
          className={
            s.href === activa
              ? 'border-b-2 border-stone-900 pb-2 font-medium text-stone-900'
              : 'border-b-2 border-transparent pb-2 text-stone-500 hover:text-stone-900'
          }
        >
          {s.etiqueta}
        </Link>
      ))}
    </nav>
  )
}
