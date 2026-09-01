import { expect, test } from '@playwright/test'

/**
 * Prueba de humo contra un build de PRODUCCIÓN (`next build` + `next start`).
 *
 * No es lo mismo que el resto de la suite, que corre contra `next dev`: el
 * build de producción prerrenderiza, fija NODE_ENV=production y desactiva las
 * ayudas del modo desarrollo. Ya encontró dos cosas que `next dev` no muestra:
 * la pantalla de login quedaba cacheada como estática con la lista vacía, y el
 * login de desarrollo se apagaba sin dejar ninguna forma de entrar.
 *
 * A diferencia de los demás specs, este NO inyecta la cookie de sesión: entra
 * por la pantalla, que es lo que hace una persona.
 */
test.describe('Humo sobre el build de producción', () => {
  test('se entra por la pantalla de login y se recorre la aplicación', async ({ page }) => {
    await page.goto('/login')

    // La lista de usuarios del seed tiene que llegar renderizada.
    const entrar = page.getByRole('button', { name: /Cantina Norte/ }).first()
    await expect(entrar).toBeVisible()
    await entrar.click()
    await expect(page).toHaveURL(/\/recetas$/)

    const secciones: [string, string][] = [
      ['/recetas', 'Fichas técnicas'],
      ['/insumos', 'Insumos'],
      ['/ventas', 'Importaciones'],
      ['/compras', 'Compras'],
      ['/inventario', 'Conteos de inventario'],
      ['/inventario/stock', 'Stock teórico'],
      ['/inventario/varianza', 'Varianza de food cost'],
      ['/mermas', 'Mermas'],
      ['/personal', 'Personal'],
      ['/personal/turnos', 'Turnos'],
      ['/ordenes', 'Órdenes de compra'],
      ['/dashboard', 'Resultados'],
      ['/finanzas', 'Finanzas'],
      ['/finanzas/gastos', 'Finanzas'],
      ['/finanzas/fiscal', 'Finanzas'],
      ['/finanzas/sucursales', 'Finanzas'],
      ['/asistente', 'Asistente'],
      ['/asistente/alertas', 'Asistente'],
      ['/asistente/redes', 'Asistente'],
      ['/asistente/recetas', 'Asistente'],
    ]

    for (const [ruta, titulo] of secciones) {
      const respuesta = await page.goto(ruta)
      expect(respuesta?.status(), `${ruta} devolvió un error`).toBeLessThan(400)
      await expect(page.locator('h1'), `${ruta} no renderizó`).toContainText(titulo)
    }

    // Y las cifras verificadas siguen siendo las mismas en producción.
    await page.goto('/dashboard')
    await expect(page.getByTestId('kpi-ventas')).toHaveText('$ 484.800,00')
    await page.goto('/finanzas')
    await expect(page.getByTestId('ebitda')).toHaveText('-$ 2.110.306,71')
  })

  test('cerrar sesión devuelve al login', async ({ page }) => {
    await page.goto('/login')
    await page.getByRole('button', { name: /Cantina Norte/ }).first().click()
    await expect(page).toHaveURL(/\/recetas$/)

    await page.getByRole('button', { name: 'Salir' }).click()
    await expect(page).toHaveURL(/\/login$/)

    // Y sin sesión, una ruta interna redirige.
    await page.goto('/dashboard')
    await expect(page).toHaveURL(/\/login$/)
  })
})
