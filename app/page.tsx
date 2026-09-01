import { redirect } from 'next/navigation'
import { usuarioActual } from '@/lib/sesion'

export default async function Inicio() {
  const usuario = await usuarioActual()
  redirect(usuario ? '/recetas' : '/login')
}
