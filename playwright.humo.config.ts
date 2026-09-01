import base from './playwright.config'
import { defineConfig } from '@playwright/test'

/**
 * Configuración de la prueba de humo.
 *
 * Se separa de la principal por dos motivos: no excluye
 * `humo-produccion.spec.ts` —que es justamente el que corre— y no levanta
 * ningún servidor, porque `scripts/humo.sh` ya dejó uno de producción escuchando.
 */
export default defineConfig({
  ...base,
  testIgnore: undefined,
  testMatch: '**/humo-produccion.spec.ts',
  webServer: undefined,
  use: { ...base.use, baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3100' },
})
