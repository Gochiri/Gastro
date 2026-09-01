/**
 * Parseo de importes de un CSV.
 *
 * `"1.234,56"` son mil doscientos treinta y cuatro con cincuenta y seis en
 * Argentina, y `"1,234.56"` lo mismo en México o en un export en inglés.
 * Confundirlos cambia el número por mil, y el error es invisible mirando el
 * dashboard: los importes siguen pareciendo plausibles.
 *
 * Por eso el formato NO se adivina valor por valor, sino una vez por columna
 * mirando toda la muestra. Un `"1,234"` aislado es ambiguo; en una columna donde
 * también aparece `"12,50"` deja de serlo.
 */

export type FormatoNumerico = 'latam' | 'us'

export interface DeteccionFormato {
  formato: FormatoNumerico
  /** Cuántos valores dieron evidencia clara. 0 = se usó el valor por defecto. */
  evidencia: number
  ambiguo: boolean
}

const SOLO_NUMERO = /[^0-9.,-]/g

function limpiar(texto: string): string {
  return texto.trim().replace(SOLO_NUMERO, '')
}

/**
 * Voto de un valor suelto sobre qué separador es el decimal.
 * `null` cuando el valor no aporta información.
 */
function votar(valor: string): FormatoNumerico | null {
  const s = limpiar(valor)
  if (!s) return null

  const puntos = (s.match(/\./g) ?? []).length
  const comas = (s.match(/,/g) ?? []).length

  // Ambos presentes: el último es el decimal.
  if (puntos > 0 && comas > 0) {
    return s.lastIndexOf(',') > s.lastIndexOf('.') ? 'latam' : 'us'
  }

  // Repetido: solo puede ser separador de miles.
  if (puntos > 1) return 'latam' // 1.234.567 -> el punto agrupa
  if (comas > 1) return 'us' //     1,234,567 -> la coma agrupa

  // Uno solo: decide la cantidad de dígitos que le siguen.
  // Tres dígitos es ambiguo ("1,234" puede ser 1234 o 1,234).
  const conDecimales = /[.,](\d{1,2})$/.exec(s)
  if (conDecimales) return comas === 1 ? 'latam' : 'us'

  return null
}

export function detectarFormato(
  muestras: readonly string[],
  porDefecto: FormatoNumerico = 'latam',
): DeteccionFormato {
  let latam = 0
  let us = 0
  for (const m of muestras) {
    const voto = votar(m)
    if (voto === 'latam') latam += 1
    else if (voto === 'us') us += 1
  }

  const evidencia = latam + us
  if (evidencia === 0) return { formato: porDefecto, evidencia: 0, ambiguo: true }

  return {
    formato: latam >= us ? 'latam' : 'us',
    evidencia,
    // Formatos mezclados en la misma columna: casi siempre significa que el
    // archivo viene de dos fuentes distintas. Vale la pena avisar.
    ambiguo: latam > 0 && us > 0,
  }
}

/**
 * Convierte a número según el formato ya decidido.
 * Devuelve `null` para vacío o basura: nunca 0, que se confundiría con una
 * venta real de importe cero.
 */
export function parsearNumero(
  texto: string | null | undefined,
  formato: FormatoNumerico,
): number | null {
  if (texto === null || texto === undefined) return null
  const s = limpiar(String(texto))
  if (!s || s === '-') return null

  const sinGrupos =
    formato === 'latam' ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '')

  const valor = Number(sinGrupos)
  return Number.isFinite(valor) ? valor : null
}

/** Fechas de CSV: ISO, dd/mm/aaaa y dd-mm-aaaa. */
export function parsearFecha(texto: string | null | undefined): string | null {
  if (!texto) return null
  const s = String(texto).trim()

  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s)
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`

  const dmy = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/.exec(s)
  if (dmy) {
    const [, d, m, a] = dmy
    const anio = a.length === 2 ? `20${a}` : a
    return `${anio}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
  }
  return null
}
