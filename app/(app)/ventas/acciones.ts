'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { usuarioActual } from '@/lib/sesion'
import { inspeccionar } from '@/lib/csv'
import { asignarProducto, cargarCsv, confirmarImportacion } from '@/consultas/ventas'
import { consultar } from '@/lib/db'

async function usuario(): Promise<string> {
  const id = await usuarioActual()
  if (!id) redirect('/login')
  return id
}

export interface EstadoImportacion {
  error?: string
  aviso?: string
  importacionId?: string
}

/**
 * Sube un CSV y lo deja en revisión.
 *
 * El mapeo de columnas y el formato numérico se detectan, no se imponen: se
 * muestran en la pantalla siguiente para que la persona los confirme antes de
 * que ninguna venta entre al sistema.
 */
export async function subirCsv(
  _previo: EstadoImportacion,
  formData: FormData,
): Promise<EstadoImportacion> {
  const archivo = formData.get('archivo')
  if (!(archivo instanceof File) || archivo.size === 0) {
    return { error: 'Elegí un archivo CSV.' }
  }
  if (archivo.size > 5_000_000) {
    return { error: 'El archivo supera los 5 MB.' }
  }

  const contenido = await archivo.text()
  const inspeccion = inspeccionar(contenido)

  if (!inspeccion.mapeoSugerido.fecha || !inspeccion.mapeoSugerido.producto ||
      !inspeccion.mapeoSugerido.importe) {
    return {
      error:
        'No se reconocieron las columnas mínimas (fecha, producto e importe). ' +
        `El archivo trae: ${inspeccion.columnas.map((c) => c.nombre).join(', ')}.`,
    }
  }

  try {
    const resultado = await cargarCsv(await usuario(), {
      nombreArchivo: archivo.name,
      contenido,
      mapeo: inspeccion.mapeoSugerido,
      formato: inspeccion.formatoDetectado,
    })
    revalidatePath('/ventas')
    return {
      importacionId: resultado.importacionId,
      aviso: inspeccion.formatoAmbiguo
        ? 'La columna de importes mezcla convenciones numéricas. Revisá los valores antes de confirmar.'
        : undefined,
    }
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'No se pudo procesar el archivo.' }
  }
}

export async function resolverProducto(formData: FormData): Promise<void> {
  const stagingId = String(formData.get('stagingId') ?? '')
  const productoId = String(formData.get('productoId') ?? '')
  if (!stagingId || !productoId) return
  await asignarProducto(await usuario(), stagingId, productoId)
  revalidatePath('/ventas/importar')
}

export async function confirmar(formData: FormData): Promise<void> {
  const importacionId = String(formData.get('importacionId') ?? '')
  await confirmarImportacion(await usuario(), importacionId)
  revalidatePath('/ventas')
  revalidatePath('/dashboard')
  redirect('/dashboard')
}

export async function descartar(formData: FormData): Promise<void> {
  const importacionId = String(formData.get('importacionId') ?? '')
  await consultar(await usuario(), 'select descartar_importacion($1)', [importacionId])
  revalidatePath('/ventas')
  redirect('/ventas')
}

export interface ProductoOpcion {
  id: string
  nombre: string
}

export async function catalogoProductos(): Promise<ProductoOpcion[]> {
  const filas = await consultar<Record<string, string>>(
    await usuario(),
    'select id, nombre from productos where activo order by nombre',
  )
  return filas.map((f) => ({ id: f.id, nombre: f.nombre }))
}
