import { strict as assert } from 'node:assert'
import test from 'node:test'
import pg from 'pg'

/**
 * Verifica que el contexto de tenant sea TRANSACCIONAL y no de sesión.
 *
 * Por qué hace falta un test dedicado: un E2E que alterna usuarios no detecta
 * la diferencia, porque `withTenant` fija el claim al principio de cada
 * transacción y siempre sobrescribe el valor anterior. La diferencia solo se ve
 * al inspeccionar la conexión DESPUÉS de devolverla al pool: con ámbito de
 * sesión, la identidad del último usuario sigue pegada a ella y la heredaría
 * cualquier consulta que no pase por withTenant.
 */

const CADENA = process.env.DATABASE_URL ?? 'postgresql://app_user:test@localhost:5433/gastro'
// lib/db.ts exige DATABASE_URL al cargarse.
process.env.DATABASE_URL ??= CADENA
const USUARIO_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'

test('el claim no sobrevive a la transacción que lo fijó', async () => {
  // Pool de UNA sola conexión: garantiza que la segunda consulta reutiliza
  // exactamente la conexión que usó la primera.
  const pool = new pg.Pool({ connectionString: CADENA, max: 1 })
  try {
    // Simula lo que hace withTenant().
    const cliente = await pool.connect()
    await cliente.query('begin')
    await cliente.query('select set_config($1, $2, true)', [
      'request.jwt.claims',
      JSON.stringify({ sub: USUARIO_A }),
    ])
    const dentro = await cliente.query('select auth.uid() as uid')
    assert.equal(dentro.rows[0].uid, USUARIO_A, 'el claim debe aplicar dentro de la transacción')
    await cliente.query('commit')
    cliente.release()

    // Misma conexión, ya devuelta al pool y sin contexto declarado.
    const fuera = await pool.query('select auth.uid() as uid')
    assert.equal(
      fuera.rows[0].uid,
      null,
      'FUGA: la identidad del usuario anterior sobrevivió en la conexión. ' +
        'set_config debe usarse con ámbito transaccional (tercer argumento true).',
    )

    // Y sin identidad, RLS no debe devolver nada.
    const filas = await pool.query('select count(*)::int as n from recetas')
    assert.equal(filas.rows[0].n, 0, 'sin identidad, RLS debe ocultar todas las filas')
  } finally {
    await pool.end()
  }
})

test('el pool sobrevive a que le corten las conexiones', async () => {
  // Reproduce lo que pasa en un reinicio de la base o un failover: un
  // administrador termina las conexiones abiertas. Sin un manejador de error
  // en el pool, esto se convierte en una excepción no capturada que tumba el
  // servidor entero.
  const { withTenant, cerrarPool } = await import('../lib/db.ts')

  const antes = await withTenant(USUARIO_A, async (c) => {
    const { rows } = await c.query('select 1 as ok')
    return rows[0].ok
  })
  assert.equal(antes, 1)

  const verdugo = new pg.Pool({ connectionString: 'postgresql://postgres@localhost:5433/gastro' })
  await verdugo.query(`
    select pg_terminate_backend(pid) from pg_stat_activity
    where datname = 'gastro' and usename = 'app_user' and pid <> pg_backend_pid()`)
  await verdugo.end()

  // Un momento para que el pool procese el corte.
  await new Promise((r) => setTimeout(r, 300))

  const despues = await withTenant(USUARIO_A, async (c) => {
    const { rows } = await c.query('select 1 as ok')
    return rows[0].ok
  })
  assert.equal(despues, 1, 'el pool debe reabrir la conexión, no arrastrar el error')

  await cerrarPool()
})
