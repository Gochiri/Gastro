import { createHmac, timingSafeEqual } from 'node:crypto'
import { cookies } from 'next/headers'

/**
 * Sesión del usuario.
 *
 * En producción esto lo reemplaza Supabase Auth: solo cambia `usuarioActual()`,
 * que devuelve el `sub` del JWT verificado. El resto de la app no se entera.
 *
 * En desarrollo no hay GoTrue disponible, así que se usa una cookie firmada con
 * HMAC y una pantalla que lista los usuarios del seed.
 */

const MODO_DEV = process.env.APP_AUTH_DEV === '1'
const NOMBRE_COOKIE = 'sesion'

// Un stub de autenticación que llega a producción regala todas las cuentas.
// Que la app no arranque es exactamente el comportamiento deseado.
if (MODO_DEV && process.env.NODE_ENV === 'production') {
  throw new Error(
    'APP_AUTH_DEV=1 con NODE_ENV=production. El login de desarrollo no puede ' +
      'usarse en producción: configura Supabase Auth y quita APP_AUTH_DEV.',
  )
}

function secreto(): string {
  const valor = process.env.APP_SESSION_SECRET
  if (!valor || valor.length < 16) {
    throw new Error('Falta APP_SESSION_SECRET (mínimo 16 caracteres).')
  }
  return valor
}

function firmar(usuarioId: string): string {
  return createHmac('sha256', secreto()).update(usuarioId).digest('hex')
}

/** Valor de cookie firmado para un usuario. */
export function crearCookieSesion(usuarioId: string): string {
  return `${usuarioId}.${firmar(usuarioId)}`
}

function verificar(valor: string): string | null {
  const separador = valor.lastIndexOf('.')
  if (separador <= 0) return null

  const usuarioId = valor.slice(0, separador)
  const firmaRecibida = Buffer.from(valor.slice(separador + 1), 'utf8')
  const firmaEsperada = Buffer.from(firmar(usuarioId), 'utf8')

  if (firmaRecibida.length !== firmaEsperada.length) return null
  if (!timingSafeEqual(firmaRecibida, firmaEsperada)) return null
  return usuarioId
}

/** UUID del usuario autenticado, o null. `cookies()` es asíncrono en Next 16. */
export async function usuarioActual(): Promise<string | null> {
  const almacen = await cookies()
  const cookie = almacen.get(NOMBRE_COOKIE)
  return cookie ? verificar(cookie.value) : null
}

export const COOKIE_SESION = NOMBRE_COOKIE
