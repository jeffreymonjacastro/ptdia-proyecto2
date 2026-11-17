export type ConnectionConfig = { apiUrl:string; supabaseUrl:string; publishableKey:string; backendReady:boolean }
const origin = (raw:string, name:string) => {
  let parsed: URL
  try { parsed = new URL(raw) } catch { throw new Error(`Configura una URL válida para ${name}.`) }
  if (!['http:','https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error(`Configura una URL válida para ${name}.`)
  return parsed.origin
}
export function validatePublishableKey(key: string) {
  let role = ''
  if (key.split('.').length === 3) {
    try { role = JSON.parse(atob(key.split('.')[1].replace(/-/g,'+').replace(/_/g,'/'))).role ?? '' } catch { /* El SDK valida la clave al iniciar sesión. */ }
  }
  if (key.startsWith('sb_secret_') || role === 'service_role') throw new Error('Usa solo la publishable key de Supabase. Una secret key no puede exponerse en el frontend.')
}
export function readConfig(env: Record<string,string|undefined>): ConnectionConfig | null {
  if (env.VITE_APP_MODE === 'demo') return null
  const api = env.VITE_API_BASE_URL?.trim()
  const supabase = env.VITE_SUPABASE_URL?.trim()
  const key = env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim()
  if (!env.VITE_APP_MODE && !api && !supabase && !key) return null
  if (!supabase || !key) throw new Error('Configura la URL de Supabase y su publishable key para conectar el estudio.')
  validatePublishableKey(key)
  const apiUrl = origin(api || 'https://TU-BACKEND.ngrok-free.app','el backend')
  return { apiUrl, supabaseUrl:origin(supabase,'Supabase'), publishableKey:key, backendReady:!apiUrl.toLowerCase().includes('tu-backend') }
}
