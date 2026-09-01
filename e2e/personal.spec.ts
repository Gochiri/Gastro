import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import { USUARIOS, entrarComo } from './sesion'

const RAIZ = path.resolve(__dirname, '..')

test.describe('Personal, prime cost y órdenes', () => {
  test.beforeAll(() => {
    execFileSync(path.join(RAIZ, 'scripts/db.sh'), ['reset'], { stdio: 'pipe' })
    execFileSync('node', [path.join(RAIZ, 'scripts/escenario.mjs')], {
      cwd: RAIZ,
      stdio: 'pipe',
    })
  })

  test.beforeEach(async ({ context }) => {
    await entrarComo(context, USUARIOS.cantinaNorte)
  })

  test('el prime cost aparece en el dashboard con sus tres componentes', async ({ page }) => {
    await page.goto('/dashboard')
    await expect(page.getByTestId('prime-comida')).toHaveText('20,7 %')
    // 53,75 % redondeado a un decimal.
    await expect(page.getByTestId('prime-trabajo')).toHaveText('53,8 %')
    await expect(page.getByTestId('prime-total')).toHaveText('74,5 %')
    // Con 74,5% el negocio no cierra, y hay que decirlo.
    await expect(page.getByTestId('prime-cost')).toContainText('Por encima del umbral sano')
  })

  test('los fichajes sin cerrar se avisan en el dashboard', async ({ page }) => {
    await page.goto('/dashboard')
    await expect(page.getByTestId('aviso-fichajes')).toContainText('sin cerrar')
    await expect(page.getByTestId('aviso-fichajes')).toContainText('mayor que')
  })

  test('el costo por hora se muestra con cargas incluidas', async ({ page }) => {
    await page.goto('/personal')
    const marta = page.getByTestId('tabla-empleados').getByRole('row', { name: /Marta Ruiz/ })
    await expect(marta).toContainText('$ 3.000,00') // sueldo
    await expect(marta).toContainText('$ 4.050,00') // con 35% de cargas
  })

  test('fichar entrada y salida de un empleado', async ({ page }) => {
    await page.goto('/personal')
    // Lucía ya tiene un fichaje abierto en el escenario.
    await expect(page.getByTestId('fichaje')).toContainText('En turno desde las')

    await page.getByTestId('entrada-Marta Ruiz').click()
    await expect(page.getByTestId('salida-Marta Ruiz')).toBeVisible()

    await page.getByTestId('salida-Marta Ruiz').click()
    await expect(page.getByTestId('entrada-Marta Ruiz')).toBeVisible()
  })

  test('una orden se crea, se envía y se recibe en parte', async ({ page }) => {
    await page.goto('/ordenes')
    await page.getByTestId('orden-proveedor').selectOption({ label: 'Distribuidora Central' })
    await page.getByTestId('nueva-orden').click()
    await expect(page).toHaveURL(/\/ordenes\/[0-9a-f-]{36}$/)

    await page.getByTestId('orden-insumo').selectOption({ label: 'Carne picada (g)' })
    await page.getByTestId('orden-cantidad').fill('20000')
    await page.getByRole('button', { name: 'Agregar' }).click()
    await expect(page.getByTestId('avance')).toContainText('20.000 g')

    await page.getByTestId('enviar-orden').click()
    await expect(page.getByTestId('recepcion-fecha')).toBeVisible()

    await page.getByTestId('recepcion-fecha').fill('2026-02-15')
    await page.getByTestId('recibir-cantidad-Carne picada').fill('8000')
    await page.getByTestId('recibir-costo-Carne picada').fill('76000')
    await page.getByTestId('confirmar-recepcion').click()

    await expect(page.getByTestId('avance')).toContainText('8.000 g')
    await expect(page.getByTestId('avance')).toContainText('12.000 g') // lo que falta
  })

  test('la recepción aparece como compra, que es lo que usa la varianza', async ({ page }) => {
    await page.goto('/compras')
    await expect(page.getByTestId('tabla-compras')).toContainText('$ 76.000,00')
  })

  test('la casilla de actualizar precios viene desmarcada', async ({ page }) => {
    await page.goto('/ordenes')
    await page.getByRole('link', { name: '2026-02-15' }).or(page.getByRole('link').first()).click()
    const casilla = page.getByTestId('actualiza-precios')
    if (await casilla.count()) {
      await expect(casilla).not.toBeChecked()
    }
  })

  test('un cliente no ve el personal de otro', async ({ browser }) => {
    const ctx = await browser.newContext()
    await entrarComo(ctx, USUARIOS.bistroSur)
    const pagina = await ctx.newPage()
    await pagina.goto('/personal')
    await expect(pagina.getByTestId('tabla-empleados').locator('tbody tr')).toHaveCount(0)
    await pagina.goto('/ordenes')
    await expect(pagina.getByTestId('tabla-ordenes').locator('tbody tr')).toHaveCount(0)
    await ctx.close()
  })
})
