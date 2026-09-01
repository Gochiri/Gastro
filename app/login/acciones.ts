'use server'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { COOKIE_SESION, crearCookieSesion, modoDevActivo } from '@/lib/sesion'
import { consultar } from '@/lib/db'

/** Usuarios del seed, para el login de desarrollo. */
export interface UsuarioDev {
  usuarioId: string
  organizacion: string
  rol: string
}

/**
 * Lista los miembros del seed para elegir con cuál entrar.
 *
 * La pantalla de login es previa a tener sesión, así que RLS no puede resolver
 * nada todavía: la lectura pasa por `app_dev_usuarios()`, una función
 * SECURITY DEFINER que **solo existe en el shim local**. En producción no está
 * creada y esta función nunca se llama (requiere APP_AUTH_DEV=1).
 */
export async function listarUsuariosDev(): Promise<UsuarioDev[]> {
  if (!(await modoDevActivo())) return []
  const filas = await consultar<Record<string, string>>(
    null,
    'select usuario_id, organizacion, rol from app_dev_usuarios()',
  )
  return filas.map((f) => ({
    usuarioId: f.usuario_id,
    organizacion: f.organizacion,
    rol: f.rol,
  }))
}

export async function entrarComo(formData: FormData): Promise<void> {
  if (!(await modoDevActivo())) {
    throw new Error('El login de desarrollo está desactivado.')
  }
  const usuarioId = String(formData.get('usuarioId') ?? '')
  if (!/^[0-9a-f-]{36}$/i.test(usuarioId)) {
    throw new Error('Usuario inválido.')
  }
  const almacen = await cookies()
  almacen.set(COOKIE_SESION, crearCookieSesion(usuarioId), {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
  })
  redirect('/recetas')
}

export async function salir(): Promise<void> {
  const almacen = await cookies()
  almacen.delete(COOKIE_SESION)
  redirect('/login')
}
