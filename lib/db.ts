import { Pool, type PoolClient, type QueryResultRow } from 'pg'

/**
 * Único punto del sistema que abre conexiones a Postgres.
 *
 * El aislamiento entre clientes lo hace RLS dentro de la base. Para que
 * funcione, cada consulta debe ejecutarse con la identidad del usuario y con un
 * rol que NO haga bypass de las políticas. Las dos cosas se resuelven aquí y en
 * ningún otro sitio.
 */

const cadena = process.env.DATABASE_URL

if (!cadena) {
  throw new Error(
    'Falta DATABASE_URL. Debe apuntar a un rol sin privilegios (nunca al ' +
      'superusuario ni a service_role: ambos ignoran RLS).',
  )
}

const pool = new Pool({
  connectionString: cadena,
  max: Number(process.env.DB_POOL_MAX ?? 10),
  idleTimeoutMillis: 30_000,
})

/**
 * Sin este manejador, un error en una conexión OCIOSA se convierte en una
 * excepción no capturada que tumba el proceso entero.
 *
 * No es hipotético: pasa cada vez que la base se reinicia, en un failover, o
 * cuando un administrador corta conexiones ("terminating connection due to
 * administrator command"). El pool ya sabe descartar el cliente roto y abrir
 * otro; lo único que falta es no morir mientras tanto.
 */
pool.on('error', (error) => {
  console.error('[db] conexión del pool caída, se descarta y se reabre:', error.message)
})

/** Fila de `pg` con columnas tipadas por el llamador. */
export type Fila = QueryResultRow

/**
 * Ejecuta consultas con la identidad de un usuario, dentro de una transacción.
 *
 * El ámbito transaccional es una decisión de seguridad, no de estilo: el pool
 * reutiliza conexiones entre peticiones. Con `set_config(..., false)` el valor
 * quedaría pegado a la conexión y la siguiente petición que la tomara heredaría
 * la identidad del usuario anterior — leyendo datos de otro cliente. El tercer
 * argumento `true` lo limita a la transacción, y el COMMIT/ROLLBACK lo borra.
 *
 * @param usuarioId  UUID del usuario autenticado, o null para no autenticado
 *                   (RLS no devolverá ninguna fila).
 */
export async function withTenant<T>(
  usuarioId: string | null,
  fn: (cliente: PoolClient) => Promise<T>,
): Promise<T> {
  const cliente = await pool.connect()

  // Mientras la conexión está tomada del pool, sus errores los emite el
  // CLIENTE, no el pool: si nadie escucha, un corte a mitad de transacción se
  // vuelve una excepción no capturada. Se registra y se deja que el rechazo de
  // la consulta en curso haga su trabajo.
  const alFallar = (error: Error): void => {
    console.error('[db] la conexión se cortó durante la transacción:', error.message)
  }
  cliente.on('error', alFallar)

  let rota = false
  try {
    await cliente.query('begin')
    // El claim replica el contrato de Supabase Auth: auth.uid() lee `sub`.
    await cliente.query('select set_config($1, $2, true)', [
      'request.jwt.claims',
      usuarioId ? JSON.stringify({ sub: usuarioId }) : '',
    ])
    const resultado = await fn(cliente)
    await cliente.query('commit')
    return resultado
  } catch (error) {
    rota = true
    await cliente.query('rollback').catch(() => {
      /* la conexión ya puede estar rota; el error original es el que importa */
    })
    throw error
  } finally {
    cliente.off('error', alFallar)
    // Con un argumento, el pool DESTRUYE la conexión en vez de reutilizarla.
    // Devolver una conexión posiblemente rota al pool hace que el error
    // reaparezca en una petición de otro usuario, sin relación con la causa.
    cliente.release(rota ? true : undefined)
  }
}

/** Atajo para una sola consulta dentro del contexto de un usuario. */
export async function consultar<T extends Fila>(
  usuarioId: string | null,
  sql: string,
  parametros: readonly unknown[] = [],
): Promise<T[]> {
  return withTenant(usuarioId, async (cliente) => {
    const { rows } = await cliente.query<T>(sql, parametros as unknown[])
    return rows
  })
}

/** Cierra el pool. Solo para tests y scripts, no para la app. */
export async function cerrarPool(): Promise<void> {
  await pool.end()
}
