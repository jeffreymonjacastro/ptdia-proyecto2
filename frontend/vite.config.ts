import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { validatePublishableKey } from './src/config.ts'
export default defineConfig(({mode}) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_')
  if (env.VITE_SUPABASE_PUBLISHABLE_KEY) validatePublishableKey(env.VITE_SUPABASE_PUBLISHABLE_KEY)
  return { plugins: [react(), tailwindcss()] }
})
