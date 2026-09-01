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

// ---------------------------------------------------------------------------
// Turnos planificados
// ---------------------------------------------------------------------------

export interface TurnoPlanificado {
  id: string
  empleado: string
  fecha: string
  horaInicio: string
  horaFin: string
  horas: number
  costoEstimado: number
}

export interface FilaPlanVsReal {
  empleado: string
  fecha: string
  horasPlan: number
  horasReales: number
  desvioHoras: number
  costoPlan: number
  costoReal: number
  desvioDinero: number
  situacion: 'en_plan' | 'excedido' | 'por_debajo' | 'ausente' | 'sin_planificar'
  fichajesAbiertos: number
}

export interface ResumenPlan {
  horasPlan: number
  horasReales: number
  desvioHoras: number
  costoPlan: number
  costoReal: number
  desvioDinero: number
  desvioPct: number | null
  diasEnPlan: number
  diasExcedidos: number
  diasPorDebajo: number
  ausencias: number
  sinPlanificar: number
}

export async function listarTurnos(usuarioId: string): Promise<TurnoPlanificado[]> {
  const filas = await consultar<Record<string, unknown>>(
    usuarioId,
    `select id, empleado, fecha::text as fecha,
            to_char(hora_inicio, 'HH24:MI') as hora_inicio,
            to_char(hora_fin, 'HH24:MI')    as hora_fin,
            horas, costo_estimado
     from vista_turnos order by fecha desc, hora_inicio`,
  )
  return filas.map((f) => ({
    id: String(f.id),
    empleado: String(f.empleado),
    fecha: String(f.fecha),
    horaInicio: String(f.hora_inicio),
    horaFin: String(f.hora_fin),
    horas: num(f.horas),
    costoEstimado: num(f.costo_estimado),
  }))
}

export async function planVsReal(
  usuarioId: string,
  periodo: { desde: string; hasta: string },
): Promise<FilaPlanVsReal[]> {
  const filas = await consultar<Record<string, unknown>>(
    usuarioId,
    // La fecha se castea en SQL: `pg` devuelve un `date` como objeto Date de
    // JavaScript, y String(new Date(...)) da "Sun Feb 08 2026 ...". Cortar eso
    // a diez caracteres produce "Sun Feb 0", que es exactamente el tipo de
    // error que no falla, solo queda mal.
    `select empleado_id, empleado, fecha::text as fecha,
            horas_plan, horas_reales, desvio_horas,
            costo_plan, costo_real, desvio_dinero, situacion, fichajes_abiertos
     from plan_vs_real($1::date, $2::date)`,
    [periodo.desde, periodo.hasta],
  )
  return filas.map((f) => ({
    empleado: String(f.empleado),
    fecha: String(f.fecha),
    horasPlan: num(f.horas_plan),
    horasReales: num(f.horas_reales),
    desvioHoras: num(f.desvio_horas),
    costoPlan: num(f.costo_plan),
    costoReal: num(f.costo_real),
    desvioDinero: num(f.desvio_dinero),
    situacion: String(f.situacion) as FilaPlanVsReal['situacion'],
    fichajesAbiertos: num(f.fichajes_abiertos),
  }))
}

export async function resumenPlan(
  usuarioId: string,
  periodo: { desde: string; hasta: string },
): Promise<ResumenPlan> {
  const filas = await consultar<Record<string, unknown>>(
    usuarioId,
    'select * from resumen_plan_vs_real($1::date, $2::date)',
    [periodo.desde, periodo.hasta],
  )
  const r = filas[0] ?? {}
  return {
    horasPlan: num(r.horas_plan),
    horasReales: num(r.horas_reales),
    desvioHoras: num(r.desvio_horas),
    costoPlan: num(r.costo_plan),
    costoReal: num(r.costo_real),
    desvioDinero: num(r.desvio_dinero),
    desvioPct: numOpc(r.desvio_pct),
    diasEnPlan: num(r.dias_en_plan),
    diasExcedidos: num(r.dias_excedidos),
    diasPorDebajo: num(r.dias_por_debajo),
    ausencias: num(r.ausencias),
    sinPlanificar: num(r.sin_planificar),
  }
}
