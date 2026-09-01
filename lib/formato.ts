/**
 * Formato de números e importes.
 *
 * La moneda sale de la organización, no de una constante: el mismo despliegue
 * atiende a un restaurante argentino en ARS y a uno mexicano en MXN.
 */

const LOCALES: Readonly<Record<string, string>> = {
  AR: 'es-AR',
  MX: 'es-MX',
  CO: 'es-CO',
  CL: 'es-CL',
  ES: 'es-ES',
}

export function localeDePais(pais: string): string {
  return LOCALES[pais.toUpperCase()] ?? 'es-419'
}

export function formatearImporte(
  valor: number,
  moneda: string,
  pais: string,
  decimales = 2,
): string {
  return new Intl.NumberFormat(localeDePais(pais), {
    style: 'currency',
    currency: moneda,
    minimumFractionDigits: decimales,
    maximumFractionDigits: decimales,
  }).format(valor)
}

export function formatearCantidad(valor: number, pais: string, decimales = 2): string {
  return new Intl.NumberFormat(localeDePais(pais), {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimales,
  }).format(valor)
}

export function formatearPorcentaje(valor: number, pais: string): string {
  return new Intl.NumberFormat(localeDePais(pais), {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(valor) + ' %'
}
