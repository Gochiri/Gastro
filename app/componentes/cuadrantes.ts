/**
 * Etiquetas y colores compartidos entre pantallas de servidor y paneles de
 * cliente.
 *
 * Viven en un módulo SIN 'use client' a propósito. Todo lo que exporta un
 * módulo marcado como cliente se convierte, al importarlo desde un Server
 * Component, en una referencia de cliente: un proxy. Leer una clave de ese
 * proxy devuelve undefined en silencio, y la celda queda vacía sin que nada
 * falle. Es exactamente lo que pasó, y lo encontró un E2E.
 */

export const ETIQUETA_CUADRANTE: Readonly<Record<string, string>> = {
  estrella: 'Estrella',
  vaca: 'Vaca lechera',
  rompecabezas: 'Rompecabezas',
  perro: 'Perro',
}

export const COLOR_CUADRANTE: Readonly<Record<string, string>> = {
  estrella: 'bg-emerald-100 text-emerald-900',
  vaca: 'bg-sky-100 text-sky-900',
  rompecabezas: 'bg-amber-100 text-amber-900',
  perro: 'bg-stone-200 text-stone-700',
}

export const COLOR_SEVERIDAD: Readonly<Record<string, string>> = {
  informativo: 'border-stone-200 bg-white',
  atencion: 'border-amber-200 bg-amber-50',
  urgente: 'border-red-200 bg-red-50',
}
