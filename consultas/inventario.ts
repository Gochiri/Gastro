import { consultar, withTenant } from '../lib/db.ts'

export interface ConteoListado {
  id: string
  tipo: 'apertura' | 'cierre' | 'ciclico'
  estado: 'borrador' | 'cerrado'
  momento: string
  items: number
  sucursal: string | null
}

export interface ItemConteo {
  id: string
  insumo: string
  cantidad: number
  unidad: string
}

export interface ConteoDetalle extends ConteoListado {
  items_detalle: ItemConteo[]
}

export interface LineaVarianza {
  insumo: string
  unidad: string
  inventarioInicial: number
  compras: number
  inventarioFinal: number
  consumoReal: number
  consumoTeorico: number
  varianzaCantidad: number
  mermasRegistradas: number
  varianzaNoExplicada: number
  varianzaDinero: number
  noExplicadaDinero: number
}

export interface ResumenVarianza {
  varianzaDinero: number
  mermasDinero: number
  noExplicadaDinero: number
  coberturaPct: number | null
  insumosComparados: number
  foodCostTeoricoPct: number | null
  foodCostRealPct: number | null
}

export interface CompraListada {
  id: string
  fecha: string
  insumo: string
  proveedor: string | null
  cantidad: number
  unidad: string
  costoTotal: number
}

export interface MermaListada {
  id: string
  fecha: string
  insumo: string
  cantidad: number
  unidad: string
  motivo: string
  costo: number | null
  notas: string | null
}

const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v))
const numOpc = (v: unknown): number | null =>
  v === null || v === undefined ? null : Number(v)

export async function listarConteos(usuarioId: string): Promise<ConteoListado[]> {
  const filas = await consultar<Record<string, string | null>>(
    usuarioId,
    `select c.id, c.tipo, c.estado, c.momento, s.nombre as sucursal,
            (select count(*) from conteo_items ci where ci.conteo_id = c.id) as items
     from conteos c
     left join sucursales s on s.id = c.sucursal_id
     order by c.momento desc`,
  )
  return filas.map((f) => ({
    id: String(f.id),
    tipo: f.tipo as ConteoListado['tipo'],
    estado: f.estado as ConteoListado['estado'],
    momento: String(f.momento),
    items: num(f.items),
    sucursal: f.sucursal,
  }))
}

export async function obtenerConteo(
  usuarioId: string,
  conteoId: string,
): Promise<ConteoDetalle | null> {
  return withTenant(usuarioId, async (cliente) => {
    const cab = await cliente.query<Record<string, string | null>>(
      `select c.id, c.tipo, c.estado, c.momento, s.nombre as sucursal
       from conteos c left join sucursales s on s.id = c.sucursal_id
       where c.id = $1`,
      [conteoId],
    )
    const c = cab.rows[0]
    if (!c) return null

    const items = await cliente.query<Record<string, string>>(
      `select ci.id, i.nombre as insumo, ci.cantidad, u.codigo as unidad
       from conteo_items ci
       join insumos i  on i.id = ci.insumo_id
       join unidades u on u.id = ci.unidad_id
       where ci.conteo_id = $1
       order by i.nombre`,
      [conteoId],
    )

    return {
      id: String(c.id),
      tipo: c.tipo as ConteoDetalle['tipo'],
      estado: c.estado as ConteoDetalle['estado'],
      momento: String(c.momento),
      sucursal: c.sucursal,
      items: items.rows.length,
      items_detalle: items.rows.map((r) => ({
        id: r.id,
        insumo: r.insumo,
        cantidad: Number(r.cantidad),
        unidad: r.unidad,
      })),
    }
  })
}

/** Los dos conteos cerrados más recientes: el par que se compara por defecto. */
export async function ultimoParCerrado(
  usuarioId: string,
): Promise<{ inicial: string; final: string } | null> {
  const filas = await consultar<Record<string, string>>(
    usuarioId,
    `select id from conteos where estado = 'cerrado' order by momento desc limit 2`,
  )
  if (filas.length < 2) return null
  return { inicial: filas[1].id, final: filas[0].id }
}

export async function varianza(
  usuarioId: string,
  inicial: string,
  final: string,
): Promise<{ lineas: LineaVarianza[]; resumen: ResumenVarianza }> {
  return withTenant(usuarioId, async (cliente) => {
    const det = await cliente.query<Record<string, string>>(
      'select * from varianza_periodo($1, $2)',
      [inicial, final],
    )
    const res = await cliente.query<Record<string, string>>(
      'select * from resumen_varianza($1, $2)',
      [inicial, final],
    )
    const r = res.rows[0] ?? {}

    return {
      lineas: det.rows.map((f) => ({
        insumo: f.insumo,
        unidad: f.unidad,
        inventarioInicial: num(f.inventario_inicial),
        compras: num(f.compras),
        inventarioFinal: num(f.inventario_final),
        consumoReal: num(f.consumo_real),
        consumoTeorico: num(f.consumo_teorico),
        varianzaCantidad: num(f.varianza_cantidad),
        mermasRegistradas: num(f.mermas_registradas),
        varianzaNoExplicada: num(f.varianza_no_explicada),
        varianzaDinero: num(f.varianza_dinero),
        noExplicadaDinero: num(f.no_explicada_dinero),
      })),
      resumen: {
        varianzaDinero: num(r.varianza_dinero),
        mermasDinero: num(r.mermas_dinero),
        noExplicadaDinero: num(r.no_explicada_dinero),
        coberturaPct: numOpc(r.cobertura_pct),
        insumosComparados: num(r.insumos_comparados),
        foodCostTeoricoPct: numOpc(r.food_cost_teorico_pct),
        foodCostRealPct: numOpc(r.food_cost_real_pct),
      },
    }
  })
}

export async function listarCompras(usuarioId: string): Promise<CompraListada[]> {
  const filas = await consultar<Record<string, string | null>>(
    usuarioId,
    `select c.id, c.fecha::text, i.nombre as insumo, p.nombre as proveedor,
            c.cantidad, u.codigo as unidad, c.costo_total
     from compras c
     join insumos i  on i.id = c.insumo_id
     join unidades u on u.id = c.unidad_id
     left join proveedores p on p.id = c.proveedor_id
     order by c.fecha desc, c.creada_en desc
     limit 100`,
  )
  return filas.map((f) => ({
    id: String(f.id),
    fecha: String(f.fecha),
    insumo: String(f.insumo),
    proveedor: f.proveedor,
    cantidad: num(f.cantidad),
    unidad: String(f.unidad),
    costoTotal: num(f.costo_total),
  }))
}

export async function listarMermas(usuarioId: string): Promise<MermaListada[]> {
  const filas = await consultar<Record<string, string | null>>(
    usuarioId,
    `select m.id, m.fecha::text, i.nombre as insumo, m.cantidad,
            u.codigo as unidad, m.motivo::text, m.costo_unitario, m.notas
     from mermas m
     join insumos i  on i.id = m.insumo_id
     join unidades u on u.id = m.unidad_id
     order by m.fecha desc, m.registrada_en desc
     limit 100`,
  )
  return filas.map((f) => ({
    id: String(f.id),
    fecha: String(f.fecha),
    insumo: String(f.insumo),
    cantidad: num(f.cantidad),
    unidad: String(f.unidad),
    motivo: String(f.motivo),
    costo: f.costo_unitario === null ? null : num(f.costo_unitario) * num(f.cantidad),
    notas: f.notas,
  }))
}

export interface InsumoOpcion {
  id: string
  nombre: string
  unidadBase: string
  unidadBaseId: string
}

export async function insumosParaSelector(usuarioId: string): Promise<InsumoOpcion[]> {
  const filas = await consultar<Record<string, string>>(
    usuarioId,
    `select i.id, i.nombre, u.codigo as unidad, u.id as unidad_id
     from insumos i join unidades u on u.id = i.unidad_base_id
     where i.activo order by i.nombre`,
  )
  return filas.map((f) => ({
    id: f.id,
    nombre: f.nombre,
    unidadBase: f.unidad,
    unidadBaseId: f.unidad_id,
  }))
}

// ---------------------------------------------------------------------------
// Movimientos y stock teórico
// ---------------------------------------------------------------------------

export interface Movimiento {
  fecha: string
  tipo: string
  insumo: string
  unidad: string
  cantidad: number
  detalle: string
  sucursal: string | null
}

export interface FilaStock {
  insumoId: string
  insumo: string
  unidad: string
  conteoBase: string
  diasDesdeConteo: number
  cantidadContada: number
  entradas: number
  salidas: number
  consumoTeorico: number
  stock: number
  valuacion: number | null
}

export interface ResumenMermas {
  costoMermas: number
  ventasCosteadas: number
  mermasPct: number | null
  registros: number
  porMotivo: Record<string, number>
}

const n2 = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v))
const n2Opc = (v: unknown): number | null =>
  v === null || v === undefined ? null : Number(v)

export async function stockTeorico(usuarioId: string, fecha: string): Promise<FilaStock[]> {
  const filas = await consultar<Record<string, unknown>>(
    usuarioId,
    // Igual que en plan_vs_real: la fecha se convierte en SQL, no en JS.
    `select insumo_id, insumo, unidad, conteo_base::text as conteo_base,
            dias_desde_conteo, cantidad_contada, entradas, salidas,
            consumo_teorico, stock, valuacion
     from stock_teorico($1::date)`,
    [fecha],
  )
  return filas.map((f) => ({
    insumoId: String(f.insumo_id),
    insumo: String(f.insumo),
    unidad: String(f.unidad),
    conteoBase: String(f.conteo_base),
    diasDesdeConteo: n2(f.dias_desde_conteo),
    cantidadContada: n2(f.cantidad_contada),
    entradas: n2(f.entradas),
    salidas: n2(f.salidas),
    consumoTeorico: n2(f.consumo_teorico),
    stock: n2(f.stock),
    valuacion: n2Opc(f.valuacion),
  }))
}

export async function movimientos(
  usuarioId: string,
  periodo: { desde: string; hasta: string },
): Promise<Movimiento[]> {
  return withTenant(usuarioId, async (cliente) => {
    const { rows } = await cliente.query<Record<string, unknown>>(
      `select m.fecha::text as fecha, m.tipo, m.insumo, m.unidad, m.cantidad,
              m.detalle, s.nombre as sucursal
       from vista_movimientos_inventario m
       left join sucursales s on s.id = m.sucursal_id
       where m.fecha between $1::date and $2::date
       order by m.fecha desc, m.insumo, m.tipo`,
      [periodo.desde, periodo.hasta],
    )
    return rows.map((r) => ({
      fecha: String(r.fecha),
      tipo: String(r.tipo),
      insumo: String(r.insumo),
      unidad: String(r.unidad),
      cantidad: n2(r.cantidad),
      detalle: String(r.detalle),
      sucursal: (r.sucursal as string) ?? null,
    }))
  })
}

export async function resumenMermas(
  usuarioId: string,
  periodo: { desde: string; hasta: string },
): Promise<ResumenMermas> {
  const filas = await consultar<Record<string, unknown>>(
    usuarioId,
    'select * from resumen_mermas($1::date, $2::date)',
    [periodo.desde, periodo.hasta],
  )
  const r = filas[0] ?? {}
  return {
    costoMermas: n2(r.costo_mermas),
    ventasCosteadas: n2(r.ventas_costeadas),
    mermasPct: n2Opc(r.mermas_pct),
    registros: n2(r.registros),
    porMotivo: (r.por_motivo as Record<string, number>) ?? {},
  }
}
