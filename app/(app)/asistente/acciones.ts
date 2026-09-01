'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { usuarioActual } from '@/lib/sesion'
import { withTenant } from '@/lib/db'
import { ejecutarWidget, hayCredenciales, type DefinicionWidget } from '@/lib/ia'
import { WIDGET_MENU, type RespuestaMenu } from '@/lib/widgets/menu'
import { WIDGET_ANOMALIAS, type RespuestaAnomalias } from '@/lib/widgets/anomalias'
import { WIDGET_RRSS, type RespuestaRrss } from '@/lib/widgets/rrss'
import { WIDGET_ESCANDALLO, type RespuestaEscandallo } from '@/lib/widgets/escandallo'
import {
  contextoAnomalias,
  contextoEscandallo,
  contextoMenu,
  contextoRrss,
  emparejarIngredientes,
  SIMILITUD_PARA_PRESELECCION,
  type CandidatoInsumo,
} from '@/consultas/widgets'
import { periodoFinanciero } from '@/consultas/finanzas'

export interface EstadoWidget<T> {
  respuesta?: T
  cifrasNoRespaldadas?: number[]
  costoUsd?: number
  error?: string
}

/**
 * Ejecuta un widget y registra la ejecución.
 *
 * Es el único camino: si un widget se ejecutara por fuera de acá, su gasto no
 * quedaría contado y su respuesta no quedaría auditada. Los fallos también se
 * registran — un widget que falla en silencio no se arregla nunca.
 */
async function ejecutarYRegistrar<T>(
  definicion: DefinicionWidget<T>,
  usuarioId: string,
  contexto: unknown,
  entrada: string,
): Promise<EstadoWidget<T>> {
  if (!hayCredenciales()) {
    return {
      error:
        'Falta configurar ANTHROPIC_API_KEY en el servidor. El widget está listo, ' +
        'pero no puede consultar al modelo sin credenciales.',
    }
  }

  try {
    const resultado = await ejecutarWidget(definicion, contexto, entrada)

    await withTenant(usuarioId, async (cliente) => {
      await cliente.query(
        `insert into ejecuciones_ia
           (organizacion_id, widget, usuario_id, pregunta, contexto, respuesta,
            cifras_no_respaldadas, modelo, tokens_entrada, tokens_salida,
            tokens_cache_lectura, costo_usd, duracion_ms)
         select m.organizacion_id, $1, auth.uid(), $2, $3, $4, $5, $6, $7, $8, $9, $10, $11
         from miembros m where m.usuario_id = auth.uid() limit 1`,
        [
          definicion.clave,
          entrada,
          JSON.stringify(contexto),
          JSON.stringify(resultado.respuesta),
          JSON.stringify(resultado.cifrasNoRespaldadas),
          resultado.modelo,
          resultado.tokensEntrada,
          resultado.tokensSalida,
          resultado.tokensCacheLectura,
          resultado.costoUsd,
          resultado.duracionMs,
        ],
      )
    })

    return {
      respuesta: resultado.respuesta,
      cifrasNoRespaldadas: resultado.cifrasNoRespaldadas,
      costoUsd: resultado.costoUsd,
    }
  } catch (error) {
    const mensaje = error instanceof Error ? error.message : 'Error desconocido.'
    await withTenant(usuarioId, async (cliente) => {
      await cliente.query(
        `insert into ejecuciones_ia
           (organizacion_id, widget, usuario_id, pregunta, contexto, error)
         select m.organizacion_id, $1, auth.uid(), $2, $3, $4
         from miembros m where m.usuario_id = auth.uid() limit 1`,
        [definicion.clave, entrada, JSON.stringify(contexto), mensaje],
      )
    }).catch(() => {
      /* si ni el log entra, el error original sigue siendo el que importa */
    })
    return { error: mensaje }
  }
}

async function usuario(): Promise<string> {
  const id = await usuarioActual()
  if (!id) redirect('/login')
  return id
}

// ---------------------------------------------------------------------------
// Analista de menú
// ---------------------------------------------------------------------------

export async function analizarMenu(
  _previo: EstadoWidget<RespuestaMenu>,
  _formData: FormData,
): Promise<EstadoWidget<RespuestaMenu>> {
  const usuarioId = await usuario()
  const periodo = await periodoFinanciero(usuarioId)
  if (!periodo) return { error: 'Todavía no hay ventas cargadas para analizar.' }

  const contexto = await contextoMenu(usuarioId, periodo)
  if (!contexto) {
    return {
      error:
        'Ninguna venta del período tiene ficha técnica cargada, así que no hay ' +
        'matriz que analizar.',
    }
  }
  return ejecutarYRegistrar(
    WIDGET_MENU,
    usuarioId,
    contexto,
    'Recomendá qué hacer con cada plato de la matriz.',
  )
}

// ---------------------------------------------------------------------------
// Detector de anomalías
// ---------------------------------------------------------------------------

export async function analizarAnomalias(
  _previo: EstadoWidget<RespuestaAnomalias>,
  _formData: FormData,
): Promise<EstadoWidget<RespuestaAnomalias>> {
  const usuarioId = await usuario()
  const periodo = await periodoFinanciero(usuarioId)
  if (!periodo) return { error: 'Todavía no hay datos cargados.' }

  const contexto = await contextoAnomalias(usuarioId, periodo)
  if (!contexto) return { error: 'Todavía no hay datos cargados.' }
  if ((contexto.senales as unknown[]).length === 0) {
    return { error: 'No hay ninguna señal detectada en el período. No hay nada que priorizar.' }
  }
  return ejecutarYRegistrar(
    WIDGET_ANOMALIAS,
    usuarioId,
    contexto,
    'Priorizá estas señales y decí qué hacer con cada una.',
  )
}

// ---------------------------------------------------------------------------
// Ideas para redes
// ---------------------------------------------------------------------------

export async function generarIdeas(
  _previo: EstadoWidget<RespuestaRrss>,
  formData: FormData,
): Promise<EstadoWidget<RespuestaRrss>> {
  const usuarioId = await usuario()
  const periodo = await periodoFinanciero(usuarioId)
  if (!periodo) return { error: 'Todavía no hay ventas cargadas.' }

  const contexto = await contextoRrss(usuarioId, periodo)
  if (!contexto) {
    return { error: 'Sin platos costeados no se puede saber cuál conviene promocionar.' }
  }

  const nota = String(formData.get('nota') ?? '').trim().slice(0, 300)
  const entrada = nota
    ? `Armá el plan semanal de contenido. Tené en cuenta esto del negocio: ${nota}`
    : 'Armá el plan semanal de contenido.'

  return ejecutarYRegistrar(WIDGET_RRSS, usuarioId, contexto, entrada)
}

// ---------------------------------------------------------------------------
// Asistente de escandallos
// ---------------------------------------------------------------------------

export interface LineaBorrador {
  ingrediente: string
  textoOriginal: string
  cantidad: number | null
  unidad: string | null
  nota: string
  candidatos: CandidatoInsumo[]
  /** Preseleccionado solo si la similitud es alta. Vacío obliga a elegir. */
  preseleccionado: string
}

export interface EstadoEscandallo extends EstadoWidget<RespuestaEscandallo> {
  texto?: string
  lineas?: LineaBorrador[]
  guardada?: { id: string; nombre: string }
}

export async function analizarReceta(
  _previo: EstadoEscandallo,
  formData: FormData,
): Promise<EstadoEscandallo> {
  const usuarioId = await usuario()
  const texto = String(formData.get('texto') ?? '').trim()
  if (texto.length < 20) {
    return { error: 'Pegá la receta completa: con menos de veinte caracteres no hay nada que estructurar.' }
  }
  if (texto.length > 4000) {
    return { texto, error: 'El texto es demasiado largo. Cargá una receta por vez.' }
  }

  const contexto = contextoEscandallo(texto)
  const estado = await ejecutarYRegistrar(WIDGET_ESCANDALLO, usuarioId, contexto, texto)
  if (!estado.respuesta) return { ...estado, texto }

  // El emparejado con el catálogo NO lo hace el modelo: lo hace el trigrama.
  const mapa = await emparejarIngredientes(
    usuarioId,
    estado.respuesta.items.map((i) => i.ingrediente),
  )

  const lineas: LineaBorrador[] = estado.respuesta.items.map((i) => {
    const candidatos = mapa[i.ingrediente] ?? []
    const mejor = candidatos[0]
    return {
      ingrediente: i.ingrediente,
      textoOriginal: i.texto_original,
      cantidad: i.cantidad,
      unidad: i.unidad,
      nota: i.nota,
      candidatos,
      preseleccionado:
        mejor && mejor.similitud >= SIMILITUD_PARA_PRESELECCION ? mejor.insumoId : '',
    }
  })

  return { ...estado, texto, lineas }
}

/**
 * Crea la receta a partir del borrador YA CONFIRMADO por una persona.
 *
 * Valida de nuevo del lado del servidor lo que la pantalla ya impide: sin
 * insumo elegido, sin cantidad o sin unidad, la línea no entra. El borrador
 * viaja por el formulario y podría venir manipulado.
 */
export async function guardarReceta(
  _previo: EstadoEscandallo,
  formData: FormData,
): Promise<EstadoEscandallo> {
  const usuarioId = await usuario()

  const nombre = String(formData.get('nombre') ?? '').trim()
  const tipo = String(formData.get('tipo') ?? 'plato')
  const rendimiento = Number(String(formData.get('rendimiento') ?? '').replace(',', '.'))
  const unidadRendimiento = String(formData.get('unidadRendimiento') ?? '').trim()

  if (!nombre) return { error: 'La receta necesita un nombre.' }
  if (!Number.isFinite(rendimiento) || rendimiento <= 0) {
    return { error: 'El rendimiento tiene que ser un número mayor que cero.' }
  }

  // Las unidades válidas salen del catálogo, no de una constante: si mañana
  // se agrega una, esto la acepta sola.
  const codigosValidos = new Set(
    (
      await withTenant(usuarioId, async (cliente) => {
        const { rows } = await cliente.query<{ codigo: string }>('select codigo from unidades')
        return rows
      })
    ).map((u) => u.codigo),
  )
  if (!codigosValidos.has(unidadRendimiento)) {
    return {
      error:
        `"${unidadRendimiento}" no es una unidad del catálogo. Las porciones se ` +
        `cargan como "u". Unidades válidas: ${[...codigosValidos].join(', ')}.`,
    }
  }

  const cantidad = Number(formData.get('lineas') ?? 0)
  const items: { insumoId: string; cantidad: number; unidad: string }[] = []
  for (let i = 0; i < cantidad; i++) {
    const insumoId = String(formData.get(`insumo-${i}`) ?? '').trim()
    const cant = Number(String(formData.get(`cantidad-${i}`) ?? '').replace(',', '.'))
    const unidad = String(formData.get(`unidad-${i}`) ?? '').trim()
    if (!insumoId) continue
    if (!Number.isFinite(cant) || cant <= 0) {
      return { error: `La línea ${i + 1} no tiene una cantidad válida.` }
    }
    if (!codigosValidos.has(unidad)) {
      return {
        error:
          `La línea ${i + 1} usa la unidad "${unidad}", que no está en el catálogo. ` +
          `Convertila a una de estas: ${[...codigosValidos].join(', ')}.`,
      }
    }
    items.push({ insumoId, cantidad: cant, unidad })
  }
  if (items.length === 0) {
    return { error: 'No hay ninguna línea con insumo elegido: no hay ficha que guardar.' }
  }

  try {
    const creada = await withTenant(usuarioId, async (cliente) => {
      const { rows } = await cliente.query<{ id: string }>(
        `insert into recetas
           (organizacion_id, nombre, tipo, rendimiento_cantidad, rendimiento_unidad_id, notas)
         select m.organizacion_id, $1, $2::tipo_receta, $3,
                (select id from unidades where codigo = $4),
                'Borrador generado por el asistente y confirmado a mano.'
         from miembros m where m.usuario_id = auth.uid() limit 1
         returning id`,
        [nombre, tipo, rendimiento, unidadRendimiento],
      )
      const recetaId = rows[0].id
      for (const [orden, item] of items.entries()) {
        await cliente.query(
          `insert into receta_items
             (organizacion_id, receta_id, componente_tipo, insumo_id, cantidad, unidad_id, orden)
           select r.organizacion_id, r.id, 'insumo', $2::uuid, $3,
                  (select id from unidades where codigo = $4), $5
           from recetas r where r.id = $1::uuid`,
          [recetaId, item.insumoId, item.cantidad, item.unidad, orden],
        )
      }
      return { id: recetaId, nombre }
    })

    revalidatePath('/recetas')
    return { guardada: creada }
  } catch (error) {
    const mensaje = error instanceof Error ? error.message : 'Error desconocido.'
    if (mensaje.includes('recetas_organizacion_id_nombre_key')) {
      return { error: `Ya existe una receta llamada "${nombre}".` }
    }
    if ((error as { code?: string }).code === '42501') {
      return { error: 'Tu rol no tiene permiso para crear recetas.' }
    }
    return { error: mensaje }
  }
}
