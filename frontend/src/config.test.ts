import test from 'node:test'
import assert from 'node:assert/strict'
import { readConfig } from './config.ts'
test('sin configuración la demo sigue siendo explícita y un modo API incompleto no cae a demo', () => {
  assert.equal(readConfig({}), null)
  assert.throws(() => readConfig({VITE_APP_MODE:'api'}), /Supabase|configura/i)
})
test('ngrok puede quedar como placeholder sin provocar llamadas a un servidor inexistente', () => {
  const config = readConfig({VITE_APP_MODE:'api',VITE_API_BASE_URL:'https://TU-BACKEND.ngrok-free.app/docs',VITE_SUPABASE_URL:'https://project.supabase.co',VITE_SUPABASE_PUBLISHABLE_KEY:'sb_publishable_example'})!
  assert.equal(config.apiUrl, 'https://tu-backend.ngrok-free.app')
  assert.equal(config.backendReady, false)
})
test('la configuración rechaza una secret key que se publicaría en el navegador', () => {
  assert.throws(() => readConfig({VITE_APP_MODE:'api',VITE_API_BASE_URL:'https://api.example.test',VITE_SUPABASE_URL:'https://project.supabase.co',VITE_SUPABASE_PUBLISHABLE_KEY:'sb_secret_accidental'}), /publishable|secret/i)
})
