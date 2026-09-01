import { createHmac } from 'node:crypto'
import type { BrowserContext, APIRequestContext } from '@playwright/test'

/** UUIDs fijos del seed (supabase/seed/seed.sql). */
export const USUARIOS = {
  cantinaNorte: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  bistroSur: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  compras: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
  soloLectura: 'dddddddd-dddd-dddd-dddd-dddddddddddd',
} as const

function cookieFirmada(usuarioId: string): string {
  const secreto = process.env.APP_SESSION_SECRET ?? 'desarrollo-local-no-usar-en-produccion'
  const firma = createHmac('sha256', secreto).update(usuarioId).digest('hex')
  return `${usuarioId}.${firma}`
}

export async function entrarComo(contexto: BrowserContext, usuarioId: string): Promise<void> {
  await contexto.addCookies([
    {
      name: 'sesion',
      value: cookieFirmada(usuarioId),
      url: 'http://localhost:3000',
      httpOnly: true,
      sameSite: 'Lax',
    },
  ])
}

export function cabeceraSesion(usuarioId: string): Record<string, string> {
  return { Cookie: `sesion=${cookieFirmada(usuarioId)}` }
}

export type ClienteApi = APIRequestContext
