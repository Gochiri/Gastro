import { consultar, withTenant } from '../lib/db.ts'

export interface Empleado {
  id: string
  nombre: string
  puesto: string | null
  costoHora: number
  cargasPct: number
  costoHoraTotal: number
  activo: boolean
  fichajeAbiertoId: string | null
  entradaAbierta: string | null
}

export interface FichajeListado {
  id: string
  empleado: string
  entrada: string
  salida: string | null
  fecha: string
  horas: number | null
  costo: number | null
  abierto: boolean
}

export interface PrimeCost {
  ventasCosteadas: number
  costoComida: number
  costoLaboral: number
  primeCost: number
  foodCostPct: number | null
  laborCostPct: number | null
  primeCostPct: number | null
  horas: number
  fichajesAbiertos: number
  coberturaPct: number | null
}

const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v))
const numOpc = (v: unknown): number | null =>
  v === null || v === undefined ? null : Number(v)

/** Empleados con su fichaje abierto, si lo tienen: es lo que necesita la pantalla de fichaje. */
export async function listarEmpleados(usuarioId: string): Promise<Empleado[]> {
  const filas = await consultar<Record<string, unknown>>(
    usuarioId,
    `select e.id, e.nombre, e.puesto, e.costo_hora, e.cargas_sociales_pct, e.activo,
            f.id      as fichaje_abierto_id,
            f.entrada as entrada_abierta
     from empleados e
     left join fichajes f on f.empleado_id = e.id and f.salida is null
     order by e.activo desc, e.nombre`,
  )
  return filas.map((f) => {
    const costoHora = num(f.costo_hora)
    const cargas = num(f.cargas_sociales_pct)
    return {
      id: String(f.id),
      nombre: String(f.nombre),
      puesto: (f.puesto as string) ?? null,
      costoHora,
      cargasPct: cargas,
      // El costo real de una hora incluye las cargas patronales.
      costoHoraTotal: Math.round(costoHora * (1 + cargas / 100) * 100) / 100,
      activo: f.activo === true,
      fichajeAbiertoId: (f.fichaje_abierto_id as string) ?? null,
      entradaAbierta: f.entrada_abierta ? String(f.entrada_abierta) : null,
    }
  })
}

export async function listarFichajes(
  usuarioId: string,
  limite = 60,
): Promise<FichajeListado[]> {
  const filas = await consultar<Record<string, unknown>>(
    usuarioId,
    `select id, empleado, entrada, salida, fecha, horas, costo, abierto
     from vista_fichajes order by entrada desc limit $1`,
    [limite],
  )
  return filas.map((f) => ({
    id: String(f.id),
    empleado: String(f.empleado),
    entrada: String(f.entrada),
    salida: f.salida ? String(f.salida) : null,
    fecha: String(f.fecha),
    horas: numOpc(f.horas),
    costo: numOpc(f.costo),
    abierto: f.abierto === true,
  }))
}

export async function primeCost(
  usuarioId: string,
  periodo: { desde: string; hasta: string },
): Promise<PrimeCost | null> {
  return withTenant(usuarioId, async (cliente) => {
    const { rows } = await cliente.query<Record<string, unknown>>(
      'select * from resumen_prime_cost($1::date, $2::date)',
      [periodo.desde, periodo.hasta],
    )
    const r = rows[0]
    if (!r) return null
    return {
      ventasCosteadas: num(r.ventas_costeadas),
      costoComida: num(r.costo_comida),
      costoLaboral: num(r.costo_laboral),
      primeCost: num(r.prime_cost),
      foodCostPct: numOpc(r.food_cost_pct),
      laborCostPct: numOpc(r.labor_cost_pct),
      primeCostPct: numOpc(r.prime_cost_pct),
      horas: num(r.horas_trabajadas),
      fichajesAbiertos: num(r.fichajes_abiertos),
      coberturaPct: numOpc(r.cobertura_costeo_pct),
    }
  })
}
