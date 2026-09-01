import { createHmac, timingSafeEqual } from 'node:crypto'
import { cookies, headers } from 'next/headers'

/**
 * Sesión del usuario.
 *
 * En producción esto lo reemplaza Supabase Auth: solo cambia `usuarioActual()`,
 * que devuelve el `sub` del JWT verificado. El resto de la app no se entera.
 *
 * En desarrollo no hay GoTrue disponible, así que se usa una cookie firmada con
 * HMAC y una pantalla que lista los usuarios del seed.
 */

const NOMBRE_COOKIE = 'sesion'

/** Anfitriones y direcciones que son la propia máquina. */
const ANFITRIONES_LOCALES = new Set(['localhost', '127.0.0.1', '[::1]', '::1'])

function sinPuerto(valor: string): string {
  // IPv6 llega entre corchetes: "[::1]:3000".
  return (valor.startsWith('[')
    ? valor.slice(0, valor.indexOf(']') + 1)
    : valor.split(':')[0]
  ).toLowerCase()
}

function esLocal(valor: string | null): boolean {
  return valor !== null && ANFITRIONES_LOCALES.has(sinPuerto(valor.trim()))
}

/**
 * Si el login de desarrollo está activo.
 *
 * Exige APP_AUTH_DEV=1. Fuera de producción con eso alcanza.
 *
 * En un build de producción —que es lo que corre `next start`, también cuando
 * alguien levanta la app en su propia máquina— se agrega una condición que
 * NADIE puede olvidarse de apagar: la petición tiene que venir de la misma
 * máquina. El día que la app quede publicada en un dominio, el login de
 * desarrollo se apaga solo.
 *
 * Es más fuerte que la regla anterior, que simplemente lo mataba en producción:
 * aquella dejaba cualquier despliegue local sin ninguna forma de entrar, y este
 * proyecto todavía no tiene Supabase Auth conectado.
 *
 * Se miran TRES cabeceras, y ninguna sobra:
 *
 *   host              el destino que pidió el cliente
 *   x-forwarded-host  el destino original si hubo un proxy en el camino
 *   x-forwarded-for   la dirección del par de la conexión
 *
 * Next.js escribe las dos últimas en toda petición, tenga proxy o no, así que
 * su mera presencia no prueba nada: lo que importa es su VALOR. Sin proxy,
 * x-forwarded-for trae la dirección real del socket (127.0.0.1); detrás de un
 * reverse proxy trae primero la IP pública del cliente, y ahí la condición
 * falla, que es exactamente lo que se busca.
 *
 * Queda un hueco residual, y conviene decirlo en vez de fingir que no existe:
 * un proxy en la MISMA máquina que además borre las cabeceras x-forwarded y
 * reescriba Host a localhost pasaría el control. Es una configuración
 * deliberada y rara; si el proyecto llega a esa topología, el camino correcto
 * es conectar Supabase Auth y sacar APP_AUTH_DEV, no endurecer esta función.
 *
 * Falla cerrado, no ruidoso: lanzar al cargar el módulo rompería `next build`,
 * que fija NODE_ENV=production incluso en local.
 */
export async function modoDevActivo(): Promise<boolean> {
  if (process.env.APP_AUTH_DEV !== '1') return false
  if (process.env.NODE_ENV !== 'production') return true

  const cabeceras = await headers()
  const host = cabeceras.get('host')
  const hostOriginal = cabeceras.get('x-forwarded-host')
  const parConexion = cabeceras.get('x-forwarded-for')?.split(',')[0] ?? null

  const local =
    esLocal(host) &&
    (hostOriginal === null || esLocal(hostOriginal)) &&
    (parConexion === null || esLocal(parConexion))

  if (local) return true

  console.error(
    '[sesion] APP_AUTH_DEV=1 con una petición que no viene de esta máquina ' +
      `(host: ${host ?? '-'}, origen: ${hostOriginal ?? '-'}, ` +
      `par: ${parConexion ?? '-'}): el login de desarrollo queda DESACTIVADO. ` +
      'Configura Supabase Auth.',
  )
  return false
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
