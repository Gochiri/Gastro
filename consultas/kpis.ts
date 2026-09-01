import { consultar, withTenant } from '../lib/db.ts'

export interface ResumenPeriodo {
  ventasBrutas: number
  comisiones: number
  costoTeorico: number
  margen: number
  foodCostPct: number | null
  margenPct: number | null
  coberturaPct: number | null
  unidades: number
  tickets: number
  ticketPromedio: number | null
}

export interface MargenCanal {
  canal: string
  unidades: number
  ventas: number
  comisiones: number
  margen: number
  margenUnitario: number
  margenPct: number | null
}

export interface MargenProducto {
  producto: string
  unidades: number
  ventas: number
  margen: number
  margenPct: number | null
  costeadoCompleto: boolean
}

export interface Periodo {
  desde: string
  hasta: string
}

const num = (v: string | null): number => (v === null ? 0 : Number(v))
const numOpc = (v: string | null): number | null => (v === null ? null : Number(v))

/** Rango con datos, para no abrir el dashboard vacío. */
export async function periodoConDatos(usuarioId: string): Promise<Periodo | null> {
  const filas = await consultar<Record<string, string | null>>(
    usuarioId,
    'select min(fecha)::text as desde, max(fecha)::text as hasta from ventas',
  )
  const f = filas[0]
  if (!f?.desde || !f?.hasta) return null
  return { desde: f.desde, hasta: f.hasta }
}

export async function resumen(
  usuarioId: string,
  periodo: Periodo,
): Promise<ResumenPeriodo> {
  const filas = await consultar<Record<string, string | null>>(
    usuarioId,
    'select * from resumen_ventas($1::date, $2::date)',
    [periodo.desde, periodo.hasta],
  )
  const r = filas[0] ?? {}
  return {
    ventasBrutas: num(r.ventas_brutas ?? null),
    comisiones: num(r.comisiones ?? null),
    costoTeorico: num(r.costo_teorico ?? null),
    margen: num(r.margen ?? null),
    foodCostPct: numOpc(r.food_cost_pct ?? null),
    margenPct: numOpc(r.margen_pct ?? null),
    coberturaPct: numOpc(r.cobertura_pct ?? null),
    unidades: num(r.unidades ?? null),
    tickets: num(r.tickets ?? null),
    ticketPromedio: numOpc(r.ticket_promedio ?? null),
  }
}

export async function margenPorCanal(
  usuarioId: string,
  periodo: Periodo,
): Promise<MargenCanal[]> {
  return withTenant(usuarioId, async (cliente) => {
    const { rows } = await cliente.query<Record<string, string | null>>(
      `select canal,
              sum(cantidad)                                       as unidades,
              round(sum(neto), 2)                                 as ventas,
              round(sum(comision), 2)                             as comisiones,
              round(sum(margen), 2)                               as margen,
              round(sum(margen) / nullif(sum(cantidad), 0), 2)    as margen_unitario,
              round(100 * sum(margen) / nullif(sum(neto), 0), 2)  as margen_pct
       from vista_ventas_analitica
       where fecha between $1::date and $2::date
       group by canal
       order by margen_unitario desc nulls last`,
      [periodo.desde, periodo.hasta],
    )
    return rows.map((r) => ({
      canal: String(r.canal),
      unidades: num(r.unidades),
      ventas: num(r.ventas),
      comisiones: num(r.comisiones),
      margen: num(r.margen),
      margenUnitario: num(r.margen_unitario),
      margenPct: numOpc(r.margen_pct),
    }))
  })
}

export async function margenPorProducto(
  usuarioId: string,
  periodo: Periodo,
): Promise<MargenProducto[]> {
  return withTenant(usuarioId, async (cliente) => {
    const { rows } = await cliente.query<Record<string, string | null>>(
      `select producto,
              sum(cantidad)                                      as unidades,
              round(sum(neto), 2)                                as ventas,
              round(sum(margen), 2)                              as margen,
              round(100 * sum(margen) / nullif(sum(neto), 0), 2) as margen_pct,
              bool_and(costeada)                                 as costeado_completo
       from vista_ventas_analitica
       where fecha between $1::date and $2::date
       group by producto
       order by margen desc`,
      [periodo.desde, periodo.hasta],
    )
    return rows.map((r) => ({
      producto: String(r.producto),
      unidades: num(r.unidades),
      ventas: num(r.ventas),
      margen: num(r.margen),
      margenPct: numOpc(r.margen_pct),
      costeadoCompleto: r.costeado_completo === 'true' || r.costeado_completo === true as never,
    }))
  })
}
