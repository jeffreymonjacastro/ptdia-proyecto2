import { useCallback, useMemo, useState, type FormEvent } from 'react'
import { type Session, type SupabaseClient } from '@supabase/supabase-js'
import App from './App.tsx'
import { getAuth, getAccessToken, useAuthSession } from './auth.ts'
import { ConnectionEntry, Mark } from './components.tsx'
import { BedroomApi } from './api.ts'
import type { ConnectionConfig } from './config.ts'
import { ImageContext } from './PrivateImage.tsx'
import { useRemoteWorkspace } from './useRemoteWorkspace.ts'

export default function AuthStudio({config}:{config:ConnectionConfig}) {
  const auth = useMemo(()=>getAuth(config),[config.supabaseUrl,config.publishableKey])
  const {session,ready,error:accessError,signOut}=useAuthSession(auth)
  const [error,setError]=useState('')
  const [busy,setBusy]=useState(false)
  async function login(event:FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if(busy)return
    const form=event.currentTarget
    const data=new FormData(form)
    setBusy(true);setError('')
    try {
      const result=await auth.auth.signInWithPassword({email:String(data.get('email')||'').trim(),password:String(data.get('password')||'')})
      if(result.error) throw result.error
      const password=form.elements.namedItem('password') as HTMLInputElement|null
      if(password)password.value=''
    }catch{setError('No se pudo iniciar sesión. Revisa el correo, la contraseña y la conexión con Supabase.')}
    finally{setBusy(false)}
  }
  if(!ready)return <div className="app-loading" role="status"><span className="spinner"/>Recuperando tu acceso…</div>
  if(!session)return <ConnectionEntry><p className="eyebrow">TU ESPACIO DE DISEÑO</p><h1>Bienvenida a tu estudio.</h1><p>Explora dormitorios y conserva las decisiones de tus proyectos.</p><form className="project-form login-form" onSubmit={event=>void login(event)}><fieldset disabled={busy}><label>Correo<input name="email" type="email" autoComplete="username" required/></label><label>Contraseña<input name="password" type="password" autoComplete="current-password" required/></label><button className="button primary full-width" type="submit" disabled={busy}>{busy?<><span className="spinner"/>Entrando…</>:'Entrar al estudio'}</button></fieldset>{(error||accessError)&&<p className="error-message" role="alert">{error||accessError}</p>}</form><p className="connection-caption">Usa la cuenta de prueba que te ha facilitado el equipo.</p></ConnectionEntry>
  if(!config.backendReady)return <ConnectionEntry><Mark/><h1>Tu cuenta está lista.</h1><p>La conexión al servidor de propuestas está pendiente. Cuando se active el túnel, reemplaza la URL de ejemplo del backend para abrir tus proyectos.</p><button className="button secondary" onClick={()=>void signOut()}>Cerrar sesión</button></ConnectionEntry>
  return <RemoteStudio key={session.user.id} auth={auth} session={session} config={config} signOut={signOut}/>
}
function RemoteStudio({auth,session,config,signOut}:{auth:SupabaseClient;session:Session;config:ConnectionConfig;signOut:()=>Promise<void>}) {
  const api = useMemo(()=>new BedroomApi(config.apiUrl,refresh=>getAccessToken(auth,session.user.id,refresh)),[auth,config.apiUrl,session.user.id])
  const remote=useRemoteWorkspace(api,{id:session.user.id,email:session.user.email},signOut)
  const imageLoader=useCallback((path:string,signal?:AbortSignal)=>api.image(path,signal),[api])
  return <ImageContext.Provider value={imageLoader}><App remote={remote}/></ImageContext.Provider>
}
