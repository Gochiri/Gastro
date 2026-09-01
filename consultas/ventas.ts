import { createHash } from 'node:crypto'
import { consultar, withTenant } from '../lib/db.ts'
import { esImportable, interpretar, type MapeoColumnas } from '../lib/csv.ts'
import type { FormatoNumerico } from '../lib/numeros.ts'

export interface ResultadoCarga {
  importacionId: string
  total: number
  ok: number
  sinProducto: number
  conError: number
}

export interface FilaPendiente {
  id: string
  numeroFila: number
  textoProducto: string
  fecha: string
  cantidad: number
  importe: number
  sugerencias: { productoId: string; nombre: string; similitud: number }[]
}

export interface ImportacionListada {
  id: string
  nombreArchivo: string
  estado: 'borrador' | 'confirmada' | 'descartada'
  filasTotal: number
  filasOk: number
  filasError: number
  creadaEn: string
  confirmadaEn: string | null
}

export function hashArchivo(contenido: string): string {
  return createHash('sha256').update(contenido).digest('hex')
}

/**
 * Carga un CSV a la zona de staging.
 *
 * Toda la resolución (producto por alias, canal por nombre normalizado) se hace
 * en una sola sentencia SQL: es donde viven las funciones de normalización y
 * donde RLS sigue aplicando.
 *
 * Un canal desconocido NO se crea sobre la marcha. Crearlo con comisión cero
 * haría desaparecer la comisión de un agregador y el margen saldría inflado.
 */
export async function cargarCsv(
  usuarioId: string,
  args: {
    nombreArchivo: string
    contenido: string
    mapeo: MapeoColumnas
    formato: FormatoNumerico
    sucursalId?: string | null
  },
): Promise<ResultadoCarga> {
  const filas = interpretar(args.contenido, args.mapeo, args.formato)
  const hash = hashArchivo(args.contenido)

  const payload = filas.map((f) => ({
    numero_fila: f.numeroFila,
    crudo: f.crudo,
    fecha: f.fecha,
    texto_producto: f.producto,
    texto_canal: f.canal,
    cantidad: f.cantidad,
    importe: f.importe,
    descuento: f.descuento,
    importable: esImportable(f),
    error: f.error,
  }))

  return withTenant(usuarioId, async (cliente) => {
    const org = await cliente.query<{ organizacion_id: string }>(
      'select organizacion_id from miembros where usuario_id = auth.uid() limit 1',
    )
    const organizacionId = org.rows[0]?.organizacion_id
    if (!organizacionId) throw new Error('El usuario no pertenece a ninguna organización.')

    let importacionId: string
    try {
      const ins = await cliente.query<{ id: string }>(
        `insert into importaciones
           (organizacion_id, sucursal_id, nombre_archivo, hash_archivo, mapeo, filas_total, creada_por)
         values ($1, $2, $3, $4, $5, $6, auth.uid())
         returning id`,
        [organizacionId, args.sucursalId ?? null, args.nombreArchivo, hash,
         JSON.stringify(args.mapeo), filas.length],
      )
      importacionId = ins.rows[0].id
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === '23505') {
        throw new Error(
          'Este archivo ya se importó. Subirlo otra vez duplicaría las ventas del período.',
        )
      }
      throw error
    }

    await cliente.query(
      `insert into ventas_staging (
         organizacion_id, importacion_id, numero_fila, crudo, fecha,
         texto_producto, texto_canal, cantidad, importe_bruto, descuento,
         producto_id, canal_id, estado, error)
       select $1, $2, f.numero_fila, f.crudo, f.fecha::date,
              f.texto_producto, f.texto_canal, f.cantidad, f.importe, coalesce(f.descuento, 0),
              resolver_producto(f.texto_producto),
              c.id,
              case
                when not f.importable                       then 'error'::estado_fila
                when c.id is null                           then 'error'::estado_fila
                when resolver_producto(f.texto_producto) is null then 'sin_producto'::estado_fila
                else 'ok'::estado_fila
              end,
              case
                when not f.importable then f.error
                when c.id is null then 'Canal desconocido: ' || coalesce(f.texto_canal, '(vacío)')
                else f.error
              end
       from jsonb_to_recordset($3::jsonb) as f(
              numero_fila int, crudo jsonb, fecha text, texto_producto text,
              texto_canal text, cantidad numeric, importe numeric,
              descuento numeric, importable boolean, error text)
       left join canales c
              on c.organizacion_id = $1
             and app_normalizar_texto(c.nombre) = app_normalizar_texto(f.texto_canal)`,
      [organizacionId, importacionId, JSON.stringify(payload)],
    )

    const conteo = await cliente.query<Record<string, string>>(
      `select count(*) filter (where estado = 'ok')            as ok,
              count(*) filter (where estado = 'sin_producto')  as sin_producto,
              count(*) filter (where estado = 'error')         as con_error
       from ventas_staging where importacion_id = $1`,
      [importacionId],
    )
    const c = conteo.rows[0]

    await cliente.query(
      'update importaciones set filas_ok = $2, filas_error = $3 where id = $1',
      [importacionId, Number(c.ok), Number(c.con_error) + Number(c.sin_producto)],
    )

    return {
      importacionId,
      total: filas.length,
      ok: Number(c.ok),
      sinProducto: Number(c.sin_producto),
      conError: Number(c.con_error),
    }
  })
}

/** Filas cuyo producto no se reconoció, con candidatos por similitud. */
export async function filasPendientes(
  usuarioId: string,
  importacionId: string,
): Promise<FilaPendiente[]> {
  return withTenant(usuarioId, async (cliente) => {
    const { rows } = await cliente.query<Record<string, string>>(
      `select id, numero_fila, texto_producto, fecha, cantidad, importe_bruto
       from ventas_staging
       where importacion_id = $1 and estado = 'sin_producto'
       order by numero_fila`,
      [importacionId],
    )

    const pendientes: FilaPendiente[] = []
    for (const f of rows) {
      const sug = await cliente.query<Record<string, string>>(
        'select producto_id, nombre, similitud from proponer_productos($1, 5)',
        [f.texto_producto],
      )
      pendientes.push({
        id: f.id,
        numeroFila: Number(f.numero_fila),
        textoProducto: f.texto_producto,
        fecha: f.fecha,
        cantidad: Number(f.cantidad),
        importe: Number(f.importe_bruto),
        sugerencias: sug.rows.map((s) => ({
          productoId: s.producto_id,
          nombre: s.nombre,
          similitud: Number(s.similitud),
        })),
      })
    }
    return pendientes
  })
}

/**
 * Asigna un producto a una fila sin resolver y **recuerda la decisión**.
 *
 * Guardar el alias es el punto del ejercicio: la próxima importación resuelve
 * sola esa variante de escritura sin volver a preguntar.
 */
export async function asignarProducto(
  usuarioId: string,
  stagingId: string,
  productoId: string,
): Promise<void> {
  await withTenant(usuarioId, async (cliente) => {
    const { rows } = await cliente.query<{ organizacion_id: string; texto_producto: string }>(
      `update ventas_staging
          set producto_id = $2, estado = 'ok', error = null
        where id = $1 and estado = 'sin_producto'
        returning organizacion_id, texto_producto`,
      [stagingId, productoId],
    )
    const fila = rows[0]
    if (!fila) throw new Error('La fila no existe o ya estaba resuelta.')

    await cliente.query(
      `insert into alias_producto (organizacion_id, texto_normalizado, producto_id)
       values ($1, app_normalizar_texto($2), $3)
       on conflict (organizacion_id, texto_normalizado)
         do update set producto_id = excluded.producto_id`,
      [fila.organizacion_id, fila.texto_producto, productoId],
    )

    // Las demás filas del mismo lote con ese texto quedan resueltas también.
    await cliente.query(
      `update ventas_staging
          set producto_id = $2, estado = 'ok', error = null
        where estado = 'sin_producto'
          and app_normalizar_texto(texto_producto) = app_normalizar_texto($1)`,
      [fila.texto_producto, productoId],
    )
  })
}

export async function confirmarImportacion(
  usuarioId: string,
  importacionId: string,
): Promise<{ insertadas: number; sinCosto: number }> {
  const filas = await consultar<Record<string, string>>(
    usuarioId,
    'select insertadas, sin_costo from confirmar_importacion($1)',
    [importacionId],
  )
  return {
    insertadas: Number(filas[0]?.insertadas ?? 0),
    sinCosto: Number(filas[0]?.sin_costo ?? 0),
  }
}

export async function listarImportaciones(usuarioId: string): Promise<ImportacionListada[]> {
  const filas = await consultar<Record<string, string>>(
    usuarioId,
    `select id, nombre_archivo, estado, filas_total, filas_ok, filas_error,
            creada_en, confirmada_en
     from importaciones order by creada_en desc`,
  )
  return filas.map((f) => ({
    id: f.id,
    nombreArchivo: f.nombre_archivo,
    estado: f.estado as ImportacionListada['estado'],
    filasTotal: Number(f.filas_total),
    filasOk: Number(f.filas_ok),
    filasError: Number(f.filas_error),
    creadaEn: f.creada_en,
    confirmadaEn: f.confirmada_en,
  }))
}
