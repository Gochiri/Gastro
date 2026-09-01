import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Gestión gastronómica',
  description: 'Costeo de recetas, food cost y rentabilidad para restaurantes',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body className="bg-stone-50 text-stone-900 antialiased">{children}</body>
    </html>
  )
}
