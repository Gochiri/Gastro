import { consultar, withTenant } from '../lib/db.ts'

/**
 * Consultas de recetas.
 *
 * Los costos los calcula Postgres (`costo_receta`, `vista_recetas_costo`), que
 * está verificado contra cálculo manual en `supabase/tests/test_costeo.sql`.
 * Aquí no se hace aritmética: solo se leen valores y se convierten a number
 * para formatear.
 *
 * `pg` devuelve `numeric` como string para no perder precisión. La conversión a
 * number es segura para mostrar (los importes están muy dentro del rango de un
 * double) y ningún cálculo depende de ella.
 */

export interface Organizacion {
  id: string
  nombre: string
  pais: string
  moneda: string
}

export interface RecetaListada {
  id: string
  nombre: string
  tipo: 'plato' | 'subreceta'
  rendimientoCantidad: number
  rendimientoUnidad: string
  costoTotal: number
  costoUnitario: number
}

export interface LineaDesglose {
  insumo: string
  cantidadBruta: number
  unidad: string
  precioUnitario: number
  costo: number
  pctDelTotal: number
}

export interface RecetaDetalle extends RecetaListada {
  notas: string | null
  desglose: LineaDesglose[]
}

const aNumero = (valor: string | number | null): number =>
  valor === null ? 0 : typeof valor === 'number' ? valor : Number(valor)

/** Organización del usuario. RLS garantiza que solo vea las suyas. */
export async function organizacionActiva(usuarioId: string): Promise<Organizacion | null> {
  const filas = await consultar<{
    id: string
    nombre: string
    pais: string
    moneda: string
  }>(usuarioId, 'select id, nombre, pais, moneda from organizaciones order by nombre limit 1')
  return filas[0] ?? null
}

export async function listarRecetas(usuarioId: string): Promise<RecetaListada[]> {
  const filas = await consultar<Record<string, string>>(
    usuarioId,
    `select id, nombre, tipo, rendimiento_cantidad, rendimiento_unidad,
            costo_total, costo_unitario
     from vista_recetas_costo
     where activa
     order by tipo desc, nombre`,
  )
  return filas.map((f) => ({
    id: f.id,
    nombre: f.nombre,
    tipo: f.tipo as 'plato' | 'subreceta',
    rendimientoCantidad: aNumero(f.rendimiento_cantidad),
    rendimientoUnidad: f.rendimiento_unidad,
    costoTotal: aNumero(f.costo_total),
    costoUnitario: aNumero(f.costo_unitario),
  }))
}

/**
 * Ficha técnica completa. Devuelve null si la receta no existe **o si es de
 * otra organización**: RLS no distingue esos dos casos, y es lo correcto — un
 * 404 no debe revelar que el recurso existe en otra cuenta.
 */
export async function obtenerReceta(
  usuarioId: string,
  recetaId: string,
): Promise<RecetaDetalle | null> {
  return withTenant(usuarioId, async (cliente) => {
    const cabecera = await cliente.query<Record<string, string>>(
      `select v.id, v.nombre, v.tipo, v.rendimiento_cantidad, v.rendimiento_unidad,
              v.costo_total, v.costo_unitario, r.notas
       from vista_recetas_costo v
       join recetas r on r.id = v.id
       where v.id = $1`,
      [recetaId],
    )
    const f = cabecera.rows[0]
    if (!f) return null

    const desglose = await cliente.query<Record<string, string>>(
      'select * from costo_receta_detalle($1)',
      [recetaId],
    )

    return {
      id: f.id,
      nombre: f.nombre,
      tipo: f.tipo as 'plato' | 'subreceta',
      rendimientoCantidad: aNumero(f.rendimiento_cantidad),
      rendimientoUnidad: f.rendimiento_unidad,
      costoTotal: aNumero(f.costo_total),
      costoUnitario: aNumero(f.costo_unitario),
      notas: f.notas ?? null,
      desglose: desglose.rows.map((d) => ({
        insumo: d.insumo,
        cantidadBruta: aNumero(d.cantidad_bruta),
        unidad: d.unidad,
        precioUnitario: aNumero(d.precio_unitario),
        costo: aNumero(d.costo),
        pctDelTotal: aNumero(d.pct_del_total),
      })),
    }
  })
}
