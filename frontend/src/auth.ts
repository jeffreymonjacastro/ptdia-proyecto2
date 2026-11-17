import { useCallback, useEffect, useState } from 'react'
import { createClient, isAuthError, isAuthRetryableFetchError, type Session, type SupabaseClient } from '@supabase/supabase-js'
import { ApiError } from './api.ts'
import type { ConnectionConfig } from './config.ts'

let sharedAuth: {url:string;key:string;client:SupabaseClient} | undefined
export function getAuth(config:ConnectionConfig) {
  if (!sharedAuth || sharedAuth.url!==config.supabaseUrl || sharedAuth.key!==config.publishableKey) {
    void sharedAuth?.client.auth.dispose()
    sharedAuth={url:config.supabaseUrl,key:config.publishableKey,client:createClient(config.supabaseUrl,config.publishableKey,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:false,storage:localStorage}})}
  }
  return sharedAuth.client
}

export function useAuthSession(auth:SupabaseClient) {
  const [session,setSession] = useState<Session|null>(null)
  const [ready,setReady] = useState(false)
  const [error,setError] = useState('')
  useEffect(()=>{
    let active=true,events=0
    const {data:{subscription}}=auth.auth.onAuthStateChange((_event,next)=>{events++;if(active){setSession(next);setReady(true)}})
    void auth.auth.getSession().then(({data,error})=>{if(active&&!events){setSession(data.session);setReady(true);if(error)setError('No se pudo recuperar el acceso. Inicia sesión de nuevo.')}})
    return()=>{active=false;subscription.unsubscribe()}
  },[auth])
  const signOut = useCallback(async()=>{ await auth.auth.signOut({scope:'local'}) },[auth])
  return {session,ready,error,signOut}
}
export async function getAccessToken(auth:SupabaseClient, owner:string, refresh=false) {
  const result=refresh?await auth.auth.refreshSession():await auth.auth.getSession()
  if (result.error && (!isAuthError(result.error) || isAuthRetryableFetchError(result.error) || (result.error.status??0)>=500)) {
    throw new ApiError(503,'auth_unavailable','No se pudo renovar el acceso. Conservamos tu sesión; vuelve a intentar cuando se recupere la conexión.')
  }
  if (result.data.session && result.data.session.user.id!==owner) throw new DOMException('La cuenta activa ha cambiado.','AbortError')
  return result.data.session?.access_token ?? null
}
