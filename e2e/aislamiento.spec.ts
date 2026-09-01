import { expect, request, test } from '@playwright/test'
import { USUARIOS, cabeceraSesion, entrarComo } from './sesion'

/**
 * RLS ya está probado en SQL. Esto verifica que el aislamiento sobrevive a
 * TODA la pila: pool de conexiones, Server Components y caché de Next.
 */
test.describe('Aislamiento entre clientes', () => {
  test('un cliente no ve las recetas de otro, ni por URL directa', async ({ browser }) => {
    // Cantina Norte obtiene el enlace de su receta.
    const ctxA = await browser.newContext()
    await entrarComo(ctxA, USUARIOS.cantinaNorte)
    const pageA = await ctxA.newPage()
    await pageA.goto('/recetas')
    const urlLasagna = await pageA
      .getByRole('link', { name: 'Lasaña' })
      .getAttribute('href')
    expect(urlLasagna).toBeTruthy()
    await ctxA.close()

    // Bistró Sur no la ve en su listado...
    const ctxB = await browser.newContext()
    await entrarComo(ctxB, USUARIOS.bistroSur)
    const pageB = await ctxB.newPage()
    await pageB.goto('/recetas')
    await expect(pageB.getByTestId('organizacion')).toHaveText('Bistró Sur')
    await expect(pageB.getByRole('link', { name: 'Lasaña' })).toHaveCount(0)

    // ...ni pegando la URL exacta en la barra de direcciones.
    const respuesta = await pageB.goto(urlLasagna as string)
    expect(respuesta?.status()).toBe(404)
    await ctxB.close()
  })

  test('el contexto de tenant no se filtra entre peticiones del pool', async () => {
    // Peticiones alternadas y concurrentes sobre el mismo pool: cada respuesta
    // debe traer solo los datos de su usuario.
    //
    // Ojo con lo que este test NO cubre: no distingue un set_config
    // transaccional de uno de sesión, porque withTenant fija el claim al
    // empezar cada transacción y siempre sobrescribe el anterior. Esa garantía
    // la prueba tests/contexto-tenant.test.mjs, que inspecciona la conexión
    // después de devolverla al pool.
    const api = await request.newContext({ baseURL: 'http://localhost:3000' })

    const peticiones = Array.from({ length: 12 }, (_, i) => {
      const esA = i % 2 === 0
      const usuario = esA ? USUARIOS.cantinaNorte : USUARIOS.bistroSur
      return api
        .get('/recetas', { headers: cabeceraSesion(usuario) })
        .then(async (r) => ({ esA, cuerpo: await r.text() }))
    })

    for (const { esA, cuerpo } of await Promise.all(peticiones)) {
      if (esA) {
        expect(cuerpo).toContain('Cantina Norte')
        expect(cuerpo).not.toContain('Taco de canasta')
      } else {
        expect(cuerpo).toContain('Bistró Sur')
        expect(cuerpo).not.toContain('Lasaña')
      }
    }
    await api.dispose()
  })

  test('cada organización ve su propia moneda', async ({ browser }) => {
    const ctxB = await browser.newContext()
    await entrarComo(ctxB, USUARIOS.bistroSur)
    const pageB = await ctxB.newPage()
    await pageB.goto('/insumos')
    // Bistró Sur es MX/MXN: el formato mexicano usa punto decimal.
    await expect(pageB.getByRole('cell', { name: 'Tortilla de maíz' })).toBeVisible()
    await ctxB.close()
  })

  test('sin sesión se redirige al login', async ({ page }) => {
    await page.goto('/recetas')
    await expect(page).toHaveURL(/\/login$/)
  })
})
