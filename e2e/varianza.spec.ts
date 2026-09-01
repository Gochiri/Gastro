import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import { USUARIOS, entrarComo } from './sesion'

const RAIZ = path.resolve(__dirname, '..')

/**
 * El diferenciador del producto, de punta a punta.
 *
 * El escenario planta 2 kg de carne faltantes, de los cuales 0,5 kg están
 * anotados como merma. La pantalla tiene que señalar los 1,5 kg restantes.
 */
test.describe('Varianza de food cost', () => {
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

  test('el informe señala el faltante que no tiene explicación', async ({ page }) => {
    await page.goto('/inventario')
    await page.getByTestId('ver-varianza').click()

    // 1500 g de carne a $9/g.
    await expect(page.getByTestId('cifra-principal')).toHaveText('$ 13.500,00')

    const carne = page.getByTestId('detalle-varianza').getByRole('row', { name: /Carne picada/ })
    await expect(carne).toContainText('2.000 g') // desvío total
    await expect(carne).toContainText('500 g') // explicado por merma
    await expect(carne).toContainText('1.500 g') // sin explicar
    await expect(carne).toContainText('$ 13.500,00')
  })

  test('el teórico y el real difieren, y la brecha está a la vista', async ({ page }) => {
    await page.goto('/inventario/varianza')
    await expect(page.getByTestId('fc-teorico')).toHaveText('20,7 %')
    await expect(page.getByTestId('fc-real')).toHaveText('24,9 %')
    await expect(page.getByTestId('fc-brecha')).toHaveText('+4,2 %')
  })

  test('con conteo parcial, la cobertura se declara', async ({ page }) => {
    await page.goto('/inventario/varianza')
    await expect(page.getByTestId('cobertura')).toHaveText('74,2 %')
    await expect(page.getByTestId('aviso-cobertura-varianza')).toContainText('es una estimación')
  })

  test('los insumos sin desvío no gritan', async ({ page }) => {
    await page.goto('/inventario/varianza')
    // Solo la carne debe mostrar dinero sin explicar; el resto, un guion.
    const filas = page.getByTestId('detalle-varianza').locator('tbody tr')
    await expect(filas).toHaveCount(4)
    const tomate = filas.filter({ hasText: 'Tomate perita' })
    await expect(tomate).toContainText('—')
  })

  test('un conteo nuevo se crea, se carga y se cierra', async ({ page }) => {
    await page.goto('/inventario')
    await page.getByTestId('nuevo-conteo').click()
    await expect(page).toHaveURL(/\/inventario\/[0-9a-f-]{36}$/)

    await page.getByTestId('insumo').selectOption({ label: 'Cebolla (g)' })
    await page.getByTestId('cantidad').fill('2500')
    await page.getByRole('button', { name: 'Agregar' }).click()

    await expect(page.getByTestId('items')).toContainText('Cebolla')
    await expect(page.getByTestId('items')).toContainText('2.500 g')

    await page.getByTestId('cerrar-conteo').click()
    await expect(page).toHaveURL(/\/inventario$/)
  })

  test('registrar una compra y una merma', async ({ page }) => {
    await page.goto('/compras')
    await page.getByTestId('compra-fecha').fill('2026-02-05')
    await page.getByTestId('compra-insumo').selectOption({ label: 'Cebolla (g)' })
    await page.getByTestId('compra-cantidad').fill('5000')
    await page.getByTestId('compra-costo').fill('6000')
    await page.getByRole('button', { name: 'Registrar' }).click()
    await expect(page.getByTestId('tabla-compras')).toContainText('Cebolla')

    await page.goto('/mermas')
    await page.getByTestId('merma-fecha').fill('2026-02-05')
    await page.getByTestId('merma-insumo').selectOption({ label: 'Cebolla (g)' })
    await page.getByTestId('merma-cantidad').fill('300')
    await page.getByTestId('merma-motivo').selectOption('vencimiento')
    await page.getByRole('button', { name: 'Registrar' }).click()
    await expect(page.getByTestId('tabla-mermas')).toContainText('Vencimiento')
  })

  test('un cliente no ve el inventario de otro', async ({ browser }) => {
    const ctx = await browser.newContext()
    await entrarComo(ctx, USUARIOS.bistroSur)
    const pagina = await ctx.newPage()
    await pagina.goto('/inventario')
    await expect(pagina.getByText('Todavía no hiciste ningún conteo')).toBeVisible()
    await pagina.goto('/compras')
    await expect(pagina.getByTestId('tabla-compras').locator('tbody tr')).toHaveCount(0)
    await ctx.close()
  })
})
