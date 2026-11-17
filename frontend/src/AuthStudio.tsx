import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js'
import App from './App.tsx'
import { ConnectionEntry, Mark } from './components.tsx'
import { BedroomApi } from './api.ts'
import type { ConnectionConfig } from './config.ts'
import { ImageContext } from './PrivateImage.tsx'
import { useRemoteWorkspace } from './useRemoteWorkspace.ts'

let sharedAuth: {url:string;key:string;client:SupabaseClient} | undefined
function getAuth(config:ConnectionConfig) {
  if (!sharedAuth || sharedAuth.url!==config.supabaseUrl || sharedAuth.key!==config.publishableKey) {
    sharedAuth?.client.auth.stopAutoRefresh()
    sharedAuth={url:config.supabaseUrl,key:config.publishableKey,client:createClient(config.supabaseUrl,config.publishableKey,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:false,storage:sessionStorage}})}
  }
  return sharedAuth.client
}

export default function AuthStudio({config}:{config:ConnectionConfig}) {
  const auth = useMemo(()=>getAuth(config),[config.supabaseUrl,config.publishableKey])
  const [session,setSession] = useState<Session|null>(null)
  const [ready,setReady] = useState(false)
  const [error,setError] = useState('')
  const [busy,setBusy] = useState(false)
  useEffect(()=>{
    let active=true,events=0
    const {data:{subscription}}=auth.auth.onAuthStateChange((_event,next)=>{events++;if(active){setSession(next);setReady(true)}})
    void auth.auth.getSession().then(({data,error})=>{if(active&&!events){setSession(data.session);setReady(true);if(error)setError('No se pudo recuperar el acceso. Inicia sesión de nuevo.')}})
    return()=>{active=false;subscription.unsubscribe()}
  },[auth])
  const signOut = useCallback(async()=>{ await auth.auth.signOut({scope:'local'});setSession(null) },[auth])
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
  if(!session)return <ConnectionEntry><p className="eyebrow">TU ESPACIO DE DISEÑO</p><h1>Bienvenida a tu estudio.</h1><p>Explora dormitorios y conserva las decisiones de tus proyectos.</p><form className="project-form login-form" onSubmit={event=>void login(event)}><fieldset disabled={busy}><label>Correo<input name="email" type="email" autoComplete="username" required/></label><label>Contraseña<input name="password" type="password" autoComplete="current-password" required/></label><button className="button primary full-width" type="submit" disabled={busy}>{busy?<><span className="spinner"/>Entrando…</>:'Entrar al estudio'}</button></fieldset>{error&&<p className="error-message" role="alert">{error}</p>}</form><p className="connection-caption">Usa la cuenta de prueba que te ha facilitado el equipo.</p></ConnectionEntry>
  if(!config.backendReady)return <ConnectionEntry><Mark/><h1>Tu cuenta está lista.</h1><p>La conexión al servidor de propuestas está pendiente. Cuando se active el túnel, reemplaza la URL de ejemplo del backend para abrir tus proyectos.</p><button className="button secondary" onClick={()=>void signOut()}>Cerrar sesión</button></ConnectionEntry>
  return <RemoteStudio key={session.user.id} auth={auth} session={session} config={config} signOut={signOut}/>
}
function RemoteStudio({auth,session,config,signOut}:{auth:SupabaseClient;session:Session;config:ConnectionConfig;signOut:()=>Promise<void>}) {
  const api = useMemo(()=>new BedroomApi(config.apiUrl,async(refresh)=>{
    const result=refresh?await auth.auth.refreshSession():await auth.auth.getSession()
    return result.data.session?.user.id===session.user.id ? result.data.session.access_token : null
  }),[auth,config.apiUrl,session.user.id])
  const remote=useRemoteWorkspace(api,{id:session.user.id,email:session.user.email},signOut)
  const imageLoader=useCallback((path:string,signal?:AbortSignal)=>api.image(path,signal),[api])
  return <ImageContext.Provider value={imageLoader}><App remote={remote}/></ImageContext.Provider>
}
