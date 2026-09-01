import { withTenant } from '../lib/db.ts'

/**
 * Panorama del negocio para los widgets de IA.
 *
 * Regla arquitectónica de todo el módulo: **el modelo no hace aritmética**.
 * Todas las cifras —incluidas las derivadas, como la brecha entre food cost
 * teórico y real o el margen por unidad de cada canal— se calculan en SQL y se
 * le entregan ya resueltas. El modelo interpreta y recomienda; no suma.
 *
 * Un dashboard que informa un food cost inventado porque el modelo sumó mal
 * destruye la confianza en el producto de forma irreversible.
 */

export interface ContextoNegocio {
  organizacion: { nombre: string; pais: string; moneda: string }
  periodo: { desde: string; hasta: string; dias: number }
  ventas: {
    ventas_brutas: number
    comisiones: number
    costo_materia_prima: number
    margen_contribucion: number
    margen_pct: number | null
    food_cost_pct: number | null
    cobertura_costeo_pct: number | null
    unidades_vendidas: number
    tickets: number
    ticket_promedio: number | null
  }
  canales: {
    canal: string
    unidades: number
    ventas: number
    comisiones: number
    comision_pct: number | null
    margen: number
    margen_por_unidad: number
    margen_pct: number | null
  }[]
  productos: {
    producto: string
    unidades: number
    ventas: number
    margen: number | null
    margen_pct: number | null
    costeado: boolean
  }[]
  inventario: {
    disponible: boolean
    food_cost_teorico_pct?: number | null
    food_cost_real_pct?: number | null
    brecha_puntos?: number | null
    cobertura_conteo_pct?: number | null
    desvio_total?: number
    mermas_registradas?: number
    sin_explicar?: number
    insumos: {
      insumo: string
      unidad: string
      consumo_real: number
      consumo_teorico: number
      desvio: number
      mermas: number
      sin_explicar: number
      sin_explicar_dinero: number
    }[]
  }
}

const n = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v))
const nOpc = (v: unknown): number | null =>
  v === null || v === undefined ? null : Number(v)
const r2 = (v: number): number => Math.round(v * 100) / 100
/** `pg` devuelve booleanos como boolean, pero una agregación puede dar null. */
const bool = (v: unknown): boolean => v === true || v === 't' || v === 'true'

export async function construirContexto(
  usuarioId: string,
  periodo?: { desde: string; hasta: string },
): Promise<ContextoNegocio | null> {
  return withTenant(usuarioId, async (cliente) => {
    const org = await cliente.query<Record<string, string>>(
      'select nombre, pais, moneda from organizaciones order by nombre limit 1',
    )
    if (!org.rows[0]) return null

    let desde = periodo?.desde
    let hasta = periodo?.hasta
    if (!desde || !hasta) {
      const p = await cliente.query<Record<string, string | null>>(
        'select min(fecha)::text as desde, max(fecha)::text as hasta from ventas',
      )
      desde = p.rows[0]?.desde ?? undefined
      hasta = p.rows[0]?.hasta ?? undefined
    }
    if (!desde || !hasta) return null

    const dias =
      Math.round(
        (new Date(hasta).getTime() - new Date(desde).getTime()) / 86_400_000,
      ) + 1

    const res = await cliente.query<Record<string, string | null>>(
      'select * from resumen_ventas($1::date, $2::date)',
      [desde, hasta],
    )
    const v = res.rows[0] ?? {}

    const canales = await cliente.query<Record<string, string | null>>(
      `select canal,
              sum(cantidad)                                      as unidades,
              round(sum(neto), 2)                                as ventas,
              round(sum(comision), 2)                            as comisiones,
              round(100 * sum(comision) / nullif(sum(neto), 0), 2) as comision_pct,
              round(sum(margen), 2)                              as margen,
              round(sum(margen) / nullif(sum(cantidad), 0), 2)   as margen_por_unidad,
              round(100 * sum(margen) / nullif(sum(neto), 0), 2) as margen_pct
       from vista_ventas_analitica
       where fecha between $1::date and $2::date
       group by canal order by margen_por_unidad desc nulls last`,
      [desde, hasta],
    )

    const productos = await cliente.query<Record<string, unknown>>(
      `select producto,
              sum(cantidad)                                      as unidades,
              round(sum(neto), 2)                                as ventas,
              round(sum(margen), 2)                              as margen,
              round(100 * sum(margen) / nullif(sum(neto), 0), 2) as margen_pct,
              bool_and(costeada)                                 as costeado
       from vista_ventas_analitica
       where fecha between $1::date and $2::date
       group by producto order by sum(neto) desc`,
      [desde, hasta],
    )

    // Varianza, si hay dos conteos cerrados.
    const par = await cliente.query<Record<string, string>>(
      `select id from conteos where estado = 'cerrado' order by momento desc limit 2`,
    )
    let inventario: ContextoNegocio['inventario'] = { disponible: false, insumos: [] }

    if (par.rows.length === 2) {
      const inicial = par.rows[1].id
      const final = par.rows[0].id
      const rv = await cliente.query<Record<string, string | null>>(
        'select * from resumen_varianza($1, $2)',
        [inicial, final],
      )
      const det = await cliente.query<Record<string, string>>(
        'select * from varianza_periodo($1, $2)',
        [inicial, final],
      )
      const s = rv.rows[0] ?? {}
      const teorico = nOpc(s.food_cost_teorico_pct)
      const real = nOpc(s.food_cost_real_pct)

      inventario = {
        disponible: true,
        food_cost_teorico_pct: teorico,
        food_cost_real_pct: real,
        // Derivada, calculada acá y no por el modelo.
        brecha_puntos: teorico !== null && real !== null ? r2(real - teorico) : null,
        cobertura_conteo_pct: nOpc(s.cobertura_pct),
        desvio_total: n(s.varianza_dinero),
        mermas_registradas: n(s.mermas_dinero),
        sin_explicar: n(s.no_explicada_dinero),
        insumos: det.rows.map((f) => ({
          insumo: f.insumo,
          unidad: f.unidad,
          consumo_real: n(f.consumo_real),
          consumo_teorico: n(f.consumo_teorico),
          desvio: n(f.varianza_cantidad),
          mermas: n(f.mermas_registradas),
          sin_explicar: n(f.varianza_no_explicada),
          sin_explicar_dinero: n(f.no_explicada_dinero),
        })),
      }
    }

    return {
      organizacion: {
        nombre: org.rows[0].nombre,
        pais: org.rows[0].pais,
        moneda: org.rows[0].moneda,
      },
      periodo: { desde, hasta, dias },
      ventas: {
        ventas_brutas: n(v.ventas_brutas),
        comisiones: n(v.comisiones),
        costo_materia_prima: n(v.costo_teorico),
        margen_contribucion: n(v.margen),
        margen_pct: nOpc(v.margen_pct),
        food_cost_pct: nOpc(v.food_cost_pct),
        cobertura_costeo_pct: nOpc(v.cobertura_pct),
        unidades_vendidas: n(v.unidades),
        tickets: n(v.tickets),
        ticket_promedio: nOpc(v.ticket_promedio),
      },
      canales: canales.rows.map((c) => ({
        canal: String(c.canal),
        unidades: n(c.unidades),
        ventas: n(c.ventas),
        comisiones: n(c.comisiones),
        comision_pct: nOpc(c.comision_pct),
        margen: n(c.margen),
        margen_por_unidad: n(c.margen_por_unidad),
        margen_pct: nOpc(c.margen_pct),
      })),
      // Un producto sin ficha técnica no lleva margen: mostrar el que sale de
      // suponer costo cero lo haría parecer el más rentable del negocio, y el
      // modelo lo repetiría como un hallazgo.
      productos: productos.rows.map((p) => {
        const costeado = bool(p.costeado)
        return {
          producto: String(p.producto),
          unidades: n(p.unidades),
          ventas: n(p.ventas),
          margen: costeado ? n(p.margen) : null,
          margen_pct: costeado ? nOpc(p.margen_pct) : null,
          costeado,
        }
      }),
      inventario,
    }
  })
}
