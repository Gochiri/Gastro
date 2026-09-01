import { consultar, withTenant } from '../lib/db.ts'
import type { Periodo } from './kpis.ts'

export interface Ebitda {
  ventasNetas: number
  comisiones: number
  costoMateriaPrima: number
  costoLaboral: number
  margenContribucion: number
  margenContribucionPct: number | null
  gastosFijos: number
  ebitda: number
  ebitdaPct: number | null
  gastosFueraEbitda: number
  resultado: number
  ventasSinCostear: number
  coberturaCosteoPct: number | null
  fichajesAbiertos: number
}

export interface PuntoEquilibrio {
  gastosFijosCaja: number
  margenContribucion: number
  margenContribucionPct: number | null
  ventasEquilibrio: number | null
  ventasReales: number
  brecha: number | null
  alcanzado: boolean | null
  dias: number
  ventaDiariaEquilibrio: number | null
  ventaDiariaReal: number | null
}

export interface GastoFijo {
  id: string
  sucursalId: string | null
  sucursal: string | null
  categoria: string
  concepto: string
  importeMensual: number
  vigenteDesde: string
  vigenteHasta: string | null
  enEbitda: boolean
}

export interface GastoDevengado {
  gastoId: string
  sucursal: string | null
  categoria: string
  concepto: string
  importeMensual: number
  dias: number
  importe: number
  enEbitda: boolean
  esCaja: boolean
}

export interface LineaIva {
  tasa: number
  ventasBase: number
  ivaDebito: number
  comprasBase: number
  ivaCredito: number
}

export interface ResumenFiscal {
  ivaDebito: number
  ivaCredito: number
  ivaPosicion: number
  retencionesIva: number
  ivaAPagar: number
  ingresosBrutosPct: number | null
  ingresosBrutosBase: number
  ingresosBrutos: number
  retencionesIb: number
  ibAPagar: number
  retencionesGanancias: number
  retencionesOtras: number
  totalEstimado: number
  ventasDelPeriodo: number
}

export interface Retencion {
  id: string
  fecha: string
  tipo: string
  sentido: string
  contraparte: string
  comprobante: string | null
  baseImponible: number | null
  alicuotaPct: number | null
  importe: number
}

export interface FilaSucursal {
  sucursalId: string | null
  sucursal: string
  ventas: number
  comisiones: number
  costoComida: number
  costoLaboral: number
  margenContribucion: number
  margenContribucionPct: number | null
  ventasCosteadas: number
  coberturaCosteoPct: number | null
  foodCostPct: number | null
  laborCostPct: number | null
  primeCostPct: number | null
  gastosAsignados: number
  gastosProrrateados: number
  ebitda: number
  ebitdaPct: number | null
  horas: number
  fichajesAbiertos: number
  participacionPct: number | null
}

const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v))
const numOpc = (v: unknown): number | null =>
  v === null || v === undefined ? null : Number(v)
const bool = (v: unknown): boolean => v === true || v === 'true'

/**
 * Período del cierre financiero: UN MES CALENDARIO.
 *
 * Es distinto del período del dashboard de ventas, que abarca exactamente los
 * días con ventas cargadas, y la diferencia no es cosmética:
 *
 * - El IVA se liquida por mes. Una compra del día 3 y una venta del día 6
 *   pertenecen a la misma posición fiscal; recortar el rango a los días con
 *   ventas dejaría el crédito fiscal afuera y haría pagar de más.
 * - Los gastos fijos son mensuales. Sobre un mes completo el devengamiento es
 *   exacto y no arrastra el redondeo del prorrateo.
 *
 * Se toma el mes de la última venta; sin ventas, el mes en curso, porque los
 * gastos fijos existen aunque todavía no se haya vendido nada.
 */
export async function periodoFinanciero(usuarioId: string): Promise<Periodo | null> {
  const filas = await consultar<Record<string, unknown>>(
    usuarioId,
    `with ancla as (
       select coalesce((select max(fecha) from ventas), current_date) as dia,
              exists (select 1 from ventas)                           as hay_ventas,
              exists (select 1 from gastos_fijos)                     as hay_gastos
     )
     select date_trunc('month', dia)::date::text                                    as desde,
            (date_trunc('month', dia) + interval '1 month - 1 day')::date::text     as hasta,
            (hay_ventas or hay_gastos)                                              as hay_datos
     from ancla`,
  )
  const f = filas[0]
  if (!f || !bool(f.hay_datos)) return null
  return { desde: String(f.desde), hasta: String(f.hasta) }
}

export interface CoberturaCalendario {
  dias: number
  diasConVentas: number
  primeraVenta: string | null
  ultimaVenta: string | null
}

/**
 * Cuántos días del mes tienen ventas cargadas.
 *
 * Un mes con tres días de ventas y un mes entero de alquiler da un EBITDA
 * espantoso que no describe al negocio, sino a los datos. El número se muestra
 * igual —no se recorta el período para maquillarlo— pero acompañado de esto.
 */
export async function coberturaCalendario(
  usuarioId: string,
  periodo: Periodo,
): Promise<CoberturaCalendario> {
  const filas = await consultar<Record<string, unknown>>(
    usuarioId,
    `select ($2::date - $1::date + 1)                as dias,
            count(distinct fecha)                    as dias_con_ventas,
            min(fecha)::text                         as primera,
            max(fecha)::text                         as ultima
     from ventas where fecha between $1::date and $2::date`,
    [periodo.desde, periodo.hasta],
  )
  const f = filas[0] ?? {}
  return {
    dias: num(f.dias),
    diasConVentas: num(f.dias_con_ventas),
    primeraVenta: (f.primera as string) ?? null,
    ultimaVenta: (f.ultima as string) ?? null,
  }
}

export async function ebitda(usuarioId: string, periodo: Periodo): Promise<Ebitda> {
  const filas = await consultar<Record<string, unknown>>(
    usuarioId,
    'select * from resumen_ebitda($1::date, $2::date)',
    [periodo.desde, periodo.hasta],
  )
  const r = filas[0] ?? {}
  return {
    ventasNetas: num(r.ventas_netas),
    comisiones: num(r.comisiones),
    costoMateriaPrima: num(r.costo_materia_prima),
    costoLaboral: num(r.costo_laboral),
    margenContribucion: num(r.margen_contribucion),
    margenContribucionPct: numOpc(r.margen_contribucion_pct),
    gastosFijos: num(r.gastos_fijos),
    ebitda: num(r.ebitda),
    ebitdaPct: numOpc(r.ebitda_pct),
    gastosFueraEbitda: num(r.gastos_fuera_ebitda),
    resultado: num(r.resultado),
    ventasSinCostear: num(r.ventas_sin_costear),
    coberturaCosteoPct: numOpc(r.cobertura_costeo_pct),
    fichajesAbiertos: num(r.fichajes_abiertos),
  }
}

export async function equilibrio(
  usuarioId: string,
  periodo: Periodo,
): Promise<PuntoEquilibrio> {
  const filas = await consultar<Record<string, unknown>>(
    usuarioId,
    'select * from punto_equilibrio($1::date, $2::date)',
    [periodo.desde, periodo.hasta],
  )
  const r = filas[0] ?? {}
  return {
    gastosFijosCaja: num(r.gastos_fijos_caja),
    margenContribucion: num(r.margen_contribucion),
    margenContribucionPct: numOpc(r.margen_contribucion_pct),
    // NULL cuando el margen de contribución no es positivo: no hay volumen de
    // ventas que salve un negocio que pierde plata en cada plato.
    ventasEquilibrio: numOpc(r.ventas_equilibrio),
    ventasReales: num(r.ventas_reales),
    brecha: numOpc(r.brecha),
    alcanzado: r.alcanzado === null || r.alcanzado === undefined ? null : bool(r.alcanzado),
    dias: num(r.dias),
    ventaDiariaEquilibrio: numOpc(r.venta_diaria_equilibrio),
    ventaDiariaReal: numOpc(r.venta_diaria_real),
  }
}

export async function listarGastosFijos(usuarioId: string): Promise<GastoFijo[]> {
  const filas = await consultar<Record<string, unknown>>(
    usuarioId,
    `select g.id, g.sucursal_id, s.nombre as sucursal, g.categoria::text as categoria,
            g.concepto, g.importe_mensual,
            g.vigente_desde::text as vigente_desde,
            g.vigente_hasta::text as vigente_hasta,
            app_gasto_en_ebitda(g.categoria) as en_ebitda
     from gastos_fijos g
     left join sucursales s on s.id = g.sucursal_id
     order by g.importe_mensual desc, g.concepto`,
  )
  return filas.map((f) => ({
    id: String(f.id),
    sucursalId: (f.sucursal_id as string) ?? null,
    sucursal: (f.sucursal as string) ?? null,
    categoria: String(f.categoria),
    concepto: String(f.concepto),
    importeMensual: num(f.importe_mensual),
    vigenteDesde: String(f.vigente_desde),
    vigenteHasta: (f.vigente_hasta as string) ?? null,
    enEbitda: bool(f.en_ebitda),
  }))
}

export async function gastosDevengados(
  usuarioId: string,
  periodo: Periodo,
): Promise<GastoDevengado[]> {
  const filas = await consultar<Record<string, unknown>>(
    usuarioId,
    'select * from gastos_fijos_devengados($1::date, $2::date)',
    [periodo.desde, periodo.hasta],
  )
  return filas.map((f) => ({
    gastoId: String(f.gasto_id),
    sucursal: (f.sucursal as string) ?? null,
    categoria: String(f.categoria),
    concepto: String(f.concepto),
    importeMensual: num(f.importe_mensual),
    dias: num(f.dias),
    importe: num(f.importe),
    enEbitda: bool(f.en_ebitda),
    esCaja: bool(f.es_caja),
  }))
}

export async function reporteIva(usuarioId: string, periodo: Periodo): Promise<LineaIva[]> {
  const filas = await consultar<Record<string, unknown>>(
    usuarioId,
    'select * from reporte_iva($1::date, $2::date)',
    [periodo.desde, periodo.hasta],
  )
  return filas.map((f) => ({
    tasa: num(f.tasa),
    ventasBase: num(f.ventas_base),
    ivaDebito: num(f.iva_debito),
    comprasBase: num(f.compras_base),
    ivaCredito: num(f.iva_credito),
  }))
}

export async function resumenFiscal(
  usuarioId: string,
  periodo: Periodo,
): Promise<ResumenFiscal> {
  const filas = await consultar<Record<string, unknown>>(
    usuarioId,
    'select * from resumen_fiscal($1::date, $2::date)',
    [periodo.desde, periodo.hasta],
  )
  const r = filas[0] ?? {}
  return {
    ivaDebito: num(r.iva_debito),
    ivaCredito: num(r.iva_credito),
    ivaPosicion: num(r.iva_posicion),
    retencionesIva: num(r.retenciones_iva),
    ivaAPagar: num(r.iva_a_pagar),
    ingresosBrutosPct: numOpc(r.ingresos_brutos_pct),
    ingresosBrutosBase: num(r.ingresos_brutos_base),
    ingresosBrutos: num(r.ingresos_brutos),
    retencionesIb: num(r.retenciones_ib),
    ibAPagar: num(r.ib_a_pagar),
    retencionesGanancias: num(r.retenciones_ganancias),
    retencionesOtras: num(r.retenciones_otras),
    totalEstimado: num(r.total_estimado),
    ventasDelPeriodo: num(r.ventas_del_periodo),
  }
}

export async function listarRetenciones(
  usuarioId: string,
  periodo: Periodo,
): Promise<Retencion[]> {
  return withTenant(usuarioId, async (cliente) => {
    const { rows } = await cliente.query<Record<string, unknown>>(
      `select id, fecha::text as fecha, tipo::text as tipo, sentido::text as sentido,
              contraparte, comprobante, base_imponible, alicuota_pct, importe
       from retenciones
       where fecha between $1::date and $2::date
       order by fecha desc, contraparte`,
      [periodo.desde, periodo.hasta],
    )
    return rows.map((r) => ({
      id: String(r.id),
      fecha: String(r.fecha),
      tipo: String(r.tipo),
      sentido: String(r.sentido),
      contraparte: String(r.contraparte),
      comprobante: (r.comprobante as string) ?? null,
      baseImponible: numOpc(r.base_imponible),
      alicuotaPct: numOpc(r.alicuota_pct),
      importe: num(r.importe),
    }))
  })
}

export async function comparativoSucursales(
  usuarioId: string,
  periodo: Periodo,
): Promise<FilaSucursal[]> {
  const filas = await consultar<Record<string, unknown>>(
    usuarioId,
    'select * from comparativo_sucursales($1::date, $2::date)',
    [periodo.desde, periodo.hasta],
  )
  return filas.map((f) => ({
    sucursalId: (f.sucursal_id as string) ?? null,
    sucursal: String(f.sucursal),
    ventas: num(f.ventas),
    comisiones: num(f.comisiones),
    costoComida: num(f.costo_comida),
    costoLaboral: num(f.costo_laboral),
    margenContribucion: num(f.margen_contribucion),
    margenContribucionPct: numOpc(f.margen_contribucion_pct),
    ventasCosteadas: num(f.ventas_costeadas),
    coberturaCosteoPct: numOpc(f.cobertura_costeo_pct),
    foodCostPct: numOpc(f.food_cost_pct),
    laborCostPct: numOpc(f.labor_cost_pct),
    primeCostPct: numOpc(f.prime_cost_pct),
    gastosAsignados: num(f.gastos_asignados),
    gastosProrrateados: num(f.gastos_prorrateados),
    ebitda: num(f.ebitda),
    ebitdaPct: numOpc(f.ebitda_pct),
    horas: num(f.horas),
    fichajesAbiertos: num(f.fichajes_abiertos),
    participacionPct: numOpc(f.participacion_pct),
  }))
}

export async function sucursalesParaSelector(
  usuarioId: string,
): Promise<{ id: string; nombre: string }[]> {
  const filas = await consultar<Record<string, unknown>>(
    usuarioId,
    'select id, nombre from sucursales where activa order by nombre',
  )
  return filas.map((f) => ({ id: String(f.id), nombre: String(f.nombre) }))
}
