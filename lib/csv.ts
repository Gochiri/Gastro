import Papa from 'papaparse'
import { detectarFormato, parsearFecha, parsearNumero, type FormatoNumerico } from './numeros.ts'

/**
 * Lectura de un CSV de ventas.
 *
 * El archivo lo produce el POS del cliente, así que no hay un formato fijo: el
 * delimitador, el orden de las columnas y la convención numérica cambian con
 * cada sistema. Por eso se lee en dos tiempos — primero se inspecciona, después
 * se interpreta con el mapeo que la persona confirmó.
 */

export interface Columna {
  nombre: string
  muestras: string[]
}

export interface Inspeccion {
  columnas: Columna[]
  filas: number
  formatoDetectado: FormatoNumerico
  formatoAmbiguo: boolean
  mapeoSugerido: MapeoColumnas
}

export interface MapeoColumnas {
  fecha: string | null
  producto: string | null
  canal: string | null
  cantidad: string | null
  importe: string | null
  descuento: string | null
}

export interface FilaVenta {
  numeroFila: number
  crudo: Record<string, string>
  fecha: string | null
  producto: string | null
  canal: string | null
  cantidad: number | null
  importe: number | null
  descuento: number
  error: string | null
}

const SINONIMOS: Readonly<Record<keyof MapeoColumnas, readonly string[]>> = {
  fecha: ['fecha', 'date', 'dia', 'fecha venta', 'fecha_venta'],
  producto: ['producto', 'articulo', 'item', 'descripcion', 'plato', 'product'],
  canal: ['canal', 'origen', 'channel', 'plataforma', 'medio'],
  cantidad: ['cantidad', 'cant', 'qty', 'unidades', 'quantity'],
  importe: ['importe', 'total', 'monto', 'venta', 'amount', 'subtotal'],
  descuento: ['descuento', 'desc', 'discount', 'bonificacion'],
}

const normalizar = (t: string): string =>
  t
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

function sugerirMapeo(columnas: readonly string[]): MapeoColumnas {
  const mapeo: MapeoColumnas = {
    fecha: null, producto: null, canal: null,
    cantidad: null, importe: null, descuento: null,
  }
  for (const clave of Object.keys(SINONIMOS) as (keyof MapeoColumnas)[]) {
    const encontrada = columnas.find((c) => SINONIMOS[clave].includes(normalizar(c)))
    mapeo[clave] = encontrada ?? null
  }
  return mapeo
}

/** Primer paso: leer el archivo y proponer un mapeo, sin interpretar nada aún. */
export function inspeccionar(contenido: string): Inspeccion {
  const { data, meta } = Papa.parse<Record<string, string>>(contenido, {
    header: true,
    skipEmptyLines: 'greedy', // descarta las filas vacías del medio
    delimiter: '', // autodetección: coma, punto y coma o tabulador
    transformHeader: (h) => h.trim(),
  })

  const nombres = (meta.fields ?? []).filter((f) => f.length > 0)
  const columnas: Columna[] = nombres.map((nombre) => ({
    nombre,
    muestras: data.slice(0, 20).map((f) => f[nombre] ?? '').filter(Boolean),
  }))

  const mapeoSugerido = sugerirMapeo(nombres)

  // El formato numérico se decide con toda la columna de importes, no con un
  // valor suelto: "1,234" aislado es ambiguo, junto a "12,50" no lo es.
  const columnaImporte = columnas.find((c) => c.nombre === mapeoSugerido.importe)
  const deteccion = detectarFormato(columnaImporte?.muestras ?? [])

  return {
    columnas,
    filas: data.length,
    formatoDetectado: deteccion.formato,
    formatoAmbiguo: deteccion.ambiguo,
    mapeoSugerido,
  }
}

/** Segundo paso: interpretar con el mapeo y el formato ya confirmados. */
export function interpretar(
  contenido: string,
  mapeo: MapeoColumnas,
  formato: FormatoNumerico,
): FilaVenta[] {
  const { data } = Papa.parse<Record<string, string>>(contenido, {
    header: true,
    skipEmptyLines: 'greedy',
    delimiter: '',
    transformHeader: (h) => h.trim(),
  })

  const leer = (fila: Record<string, string>, col: string | null): string =>
    col ? (fila[col] ?? '').trim() : ''

  return data.map((crudo, i) => {
    const fecha = parsearFecha(leer(crudo, mapeo.fecha))
    const producto = leer(crudo, mapeo.producto) || null
    const canal = leer(crudo, mapeo.canal) || null
    const cantidad = parsearNumero(leer(crudo, mapeo.cantidad), formato)
    const importe = parsearNumero(leer(crudo, mapeo.importe), formato)
    const descuentoCrudo = leer(crudo, mapeo.descuento)
    const descuento = parsearNumero(descuentoCrudo, formato)

    const faltantes: string[] = []
    if (!fecha) faltantes.push('fecha')
    if (!producto) faltantes.push('producto')
    if (cantidad === null || cantidad <= 0) faltantes.push('cantidad')
    if (importe === null) faltantes.push('importe')

    // Un descuento ilegible no invalida la fila, pero tampoco se asume cero en
    // silencio: se registra el problema y se cuenta como cero, avisando.
    const descuentoIlegible = descuentoCrudo !== '' && descuento === null

    let error: string | null = null
    if (faltantes.length > 0) {
      error = `Faltan o son ilegibles: ${faltantes.join(', ')}`
    } else if (descuentoIlegible) {
      error = `Descuento ilegible ("${descuentoCrudo}"), se tomó 0`
    }

    return {
      numeroFila: i + 2, // +1 por el encabezado, +1 porque las filas se cuentan desde 1
      crudo,
      fecha,
      producto,
      canal,
      cantidad,
      importe,
      descuento: descuento ?? 0,
      error,
    }
  })
}

/** Filas con datos suficientes para importarse. */
export function esImportable(fila: FilaVenta): boolean {
  return (
    fila.fecha !== null &&
    fila.producto !== null &&
    fila.cantidad !== null &&
    fila.cantidad > 0 &&
    fila.importe !== null
  )
}
