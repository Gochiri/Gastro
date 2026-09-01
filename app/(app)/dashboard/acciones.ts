'use server'

import { redirect } from 'next/navigation'
import { usuarioActual } from '@/lib/sesion'
import { withTenant } from '@/lib/db'
import { construirContexto } from '@/consultas/contexto-ia'
import { explicarKpis, hayCredenciales, type RespuestaIa } from '@/lib/ia'

export interface EstadoExplicacion {
  pregunta?: string
  respuesta?: RespuestaIa
  cifrasNoRespaldadas?: number[]
  error?: string
  costoUsd?: number
}

/**
 * Responde una pregunta sobre las métricas del período.
 *
 * Se ejecuta en el servidor. La clave de API nunca llega al navegador, y el
 * contexto que se le pasa al modelo queda guardado para poder auditar de dónde
 * salió cada número de la respuesta.
 */
export async function preguntar(
  _previo: EstadoExplicacion,
  formData: FormData,
): Promise<EstadoExplicacion> {
  const usuarioId = await usuarioActual()
  if (!usuarioId) redirect('/login')

  const pregunta = String(formData.get('pregunta') ?? '').trim()
  if (pregunta.length < 5) {
    return { error: 'Escribí una pregunta un poco más larga.' }
  }
  if (pregunta.length > 500) {
    return { error: 'La pregunta es demasiado larga.' }
  }

  if (!hayCredenciales()) {
    return {
      pregunta,
      error:
        'Falta configurar ANTHROPIC_API_KEY en el servidor. El widget está listo, ' +
        'pero no puede consultar al modelo sin credenciales.',
    }
  }

  const contexto = await construirContexto(usuarioId)
  if (!contexto) {
    return { pregunta, error: 'Todavía no hay ventas cargadas para analizar.' }
  }

  try {
    const resultado = await explicarKpis(contexto, pregunta)

    await withTenant(usuarioId, async (cliente) => {
      await cliente.query(
        `insert into ejecuciones_ia
           (organizacion_id, widget, usuario_id, pregunta, contexto, respuesta,
            cifras_no_respaldadas, modelo, tokens_entrada, tokens_salida,
            tokens_cache_lectura, costo_usd, duracion_ms)
         select m.organizacion_id, 'explicador-kpis', auth.uid(), $1, $2, $3, $4, $5,
                $6, $7, $8, $9, $10
         from miembros m where m.usuario_id = auth.uid() limit 1`,
        [
          pregunta,
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
      pregunta,
      respuesta: resultado.respuesta,
      cifrasNoRespaldadas: resultado.cifrasNoRespaldadas,
      costoUsd: resultado.costoUsd,
    }
  } catch (error) {
    const mensaje = error instanceof Error ? error.message : 'Error desconocido.'
    // El fallo también se registra: un widget que falla en silencio no se
    // arregla nunca.
    await withTenant(usuarioId, async (cliente) => {
      await cliente.query(
        `insert into ejecuciones_ia
           (organizacion_id, widget, usuario_id, pregunta, contexto, error)
         select m.organizacion_id, 'explicador-kpis', auth.uid(), $1, $2, $3
         from miembros m where m.usuario_id = auth.uid() limit 1`,
        [pregunta, JSON.stringify(contexto), mensaje],
      )
    }).catch(() => {
      /* si ni el log entra, el error original sigue siendo el que importa */
    })
    return { pregunta, error: mensaje }
  }
}
