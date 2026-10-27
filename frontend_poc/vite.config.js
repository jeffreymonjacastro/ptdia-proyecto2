import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const proxy = {
  '/generate': {
    target: 'https://throat-pacify-dice.ngrok-free.dev',
    changeOrigin: true,
    headers: { 'ngrok-skip-browser-warning': 'true' },
  },
}

export default defineConfig({
  plugins: [react()],
  server: { proxy },
  preview: { proxy },
})
