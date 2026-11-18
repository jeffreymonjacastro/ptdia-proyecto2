import { lazy, Suspense } from 'react'
import App from './App.tsx'
import { ConnectionEntry, Mark } from './components.tsx'
import { readConfig, type ConnectionConfig } from './config.ts'
const AuthStudio=lazy(()=>import('./AuthStudio.tsx'))

export default function ConnectedApp() {
  let config: ConnectionConfig | null
  try { config=readConfig(import.meta.env) }
  catch(error) { return <ConnectionEntry><Mark/><h1>Conecta tu estudio</h1><p role="status">{error instanceof Error ? error.message : 'Falta configurar la conexión.'}</p><p className="muted">Completa el archivo de configuración local y guarda los cambios para continuar.</p></ConnectionEntry> }
  if (!config) return <App/>
  return <Suspense fallback={<div className="app-loading" role="status">Abriendo tu acceso…</div>}><AuthStudio config={config}/></Suspense>
}
