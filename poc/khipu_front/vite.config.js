import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const proxy = {
  '/generate': {
    target: 'http://localhost:8000',
    changeOrigin: true,
    headers: { 'ngrok-skip-browser-warning': 'true' },
  },
}

export default defineConfig({
  plugins: [react()],
  server: { proxy },
  preview: { proxy },
})
