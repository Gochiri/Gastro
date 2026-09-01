import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import { USUARIOS, entrarComo } from './sesion'

const RAIZ = path.resolve(__dirname, '..')

test.describe('Turnos, stock y el gráfico de la carta', () => {
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

  // --- Solo lectura primero: los que escriben van al final ------------------

  test('el scatter ubica cada plato y la tabla acompaña', async ({ page }) => {
    await page.goto('/asistente')

    // Un punto por plato clasificado, con su área de acierto.
    await expect(page.getByTestId('punto-Lasaña')).toBeVisible()
    await expect(page.getByTestId('punto-Pizza Margarita')).toBeVisible()

    // El hover muestra las dos cifras del plato.
    await page.getByTestId('punto-Lasaña').hover()
    const tooltip = page.getByTestId('tooltip-scatter')
    await expect(tooltip).toContainText('Lasaña')
    await expect(tooltip).toContainText('$ 10.625,07')

    // La tabla sigue estando: es la vista accesible del mismo dato.
    await expect(page.getByTestId('tabla-matriz').locator('tbody tr')).toHaveCount(4)
  })

  test('el desvío entre plan y fichaje se muestra con sus cinco situaciones', async ({ page }) => {
    await page.goto('/personal/turnos')

    await expect(page.getByTestId('horas-plan')).toHaveText('66 h')
    await expect(page.getByTestId('horas-reales')).toHaveText('56 h')
    await expect(page.getByTestId('desvio-dinero')).toHaveText('-$ 61.020,00')

    const tabla = page.getByTestId('tabla-plan')
    await expect(tabla).toContainText('Excedido')
    await expect(tabla).toContainText('Ausente')
    await expect(tabla).toContainText('Sin planificar')

    // Un fichaje abierto se ve como 0 horas: sin el aviso parecería ausencia.
    await expect(page.getByTestId('abierto-Lucía Bravo-2026-02-07')).toHaveText(
      'fichaje sin cerrar',
    )
  })

  test('el stock teórico dice desde qué conteo se calculó', async ({ page }) => {
    await page.goto('/inventario/stock')

    const carne = page.getByTestId('stock-Carne picada')
    await expect(carne).toContainText('2026-02-08')
    await expect(page.getByText('Es una estimación, no un inventario')).toBeVisible()

    // La transferencia del escenario está en el libro, con su signo.
    const libro = page.getByTestId('tabla-movimientos')
    await expect(libro).toContainText('Transferencia (sale)')
    await expect(libro).toContainText('Transferencia (entra)')
    await expect(libro).toContainText('Faltó carne en Palermo')
  })

  test('el tablero informa las mermas contra las ventas costeadas', async ({ page }) => {
    await page.goto('/dashboard')
    // $4.500 sobre $427.000 de ventas costeadas.
    await expect(page.getByTestId('kpi-mermas')).toHaveText('1,1 %')
    await expect(page.getByTestId('aviso-sin-mermas')).toHaveCount(0)
  })

  // --- Los que escriben ----------------------------------------------------

  test('un turno nuevo entra en el desvío', async ({ page }) => {
    await page.goto('/personal/turnos')
    await page.getByTestId('turno-empleado').selectOption({ label: 'Diego Paz' })
    await page.getByTestId('turno-fecha').fill('2026-02-07')
    await page.getByTestId('turno-inicio').fill('18:00')
    await page.getByTestId('turno-fin').fill('22:00')
    await page.getByRole('button', { name: 'Planificar' }).click()

    // Diego el 7 dejaba de estar "sin planificar": ahora tiene 4 h de plan y
    // fichó 4 h, así que las horas planificadas suben de 66 a 70.
    await expect(page.getByTestId('horas-plan')).toHaveText('70 h')
    await expect(page.getByTestId('plan-Diego Paz-2026-02-07')).toContainText('En plan')
  })

  test('una transferencia cargada aparece en las dos sucursales', async ({ page }) => {
    await page.goto('/inventario/stock')
    await page.getByTestId('mov-tipo').selectOption('transferencia')
    await page.getByTestId('mov-insumo').selectOption({ label: 'Queso mozzarella' })
    await page.getByTestId('mov-cantidad').fill('500')
    await page.getByTestId('mov-fecha').fill('2026-02-10')
    await page.getByTestId('mov-origen').selectOption({ label: 'Casa Central' })
    await page.getByTestId('mov-destino').selectOption({ label: 'Sucursal Palermo' })
    await page.getByTestId('mov-motivo').fill('Prueba de traslado')
    await page.getByRole('button', { name: 'Registrar' }).click()

    const libro = page.getByTestId('tabla-movimientos')
    await expect(libro.getByRole('row', { name: /Prueba de traslado/ })).toHaveCount(2)
  })

  test('el encargado de compras no puede planificar turnos', async ({ context, page }) => {
    await entrarComo(context, USUARIOS.compras)
    await page.goto('/personal/turnos')
    await page.getByTestId('turno-fecha').fill('2026-02-20')
    await page.getByTestId('turno-inicio').fill('10:00')
    await page.getByTestId('turno-fin').fill('18:00')
    await page.getByRole('button', { name: 'Planificar' }).click()

    await expect(page.getByTestId('aviso-permisos')).toContainText('no tiene permiso')
  })
})
