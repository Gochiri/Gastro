import { existsSync } from 'node:fs'
import { defineConfig, devices } from '@playwright/test'

/**
 * El entorno trae Chromium preinstalado en /opt/pw-browsers, que puede no
 * coincidir con el build que espera la versión de @playwright/test. Usarlo por
 * ruta evita descargar un navegador (bloqueado en CI y en el contenedor).
 * Si no está, se deja que Playwright resuelva su propio navegador.
 */
const CHROMIUM_LOCAL = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
const executablePath = existsSync(CHROMIUM_LOCAL) ? CHROMIUM_LOCAL : undefined

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], launchOptions: { executablePath } },
    },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000/login',
    reuseExistingServer: true,
    timeout: 120_000,
  },
})
