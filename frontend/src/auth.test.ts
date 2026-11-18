import test,{afterEach} from 'node:test'
import assert from 'node:assert/strict'
import {Window} from 'happy-dom'
import {AuthRetryableFetchError,type SupabaseClient} from '@supabase/supabase-js'
import {BedroomApi,ApiError} from './api.ts'
const dom=new Window({url:'http://localhost:5173'})
Object.defineProperties(globalThis,{window:{value:dom,configurable:true},document:{value:dom.document,configurable:true},navigator:{value:dom.navigator,configurable:true},localStorage:{value:dom.localStorage,configurable:true},sessionStorage:{value:dom.sessionStorage,configurable:true},HTMLElement:{value:dom.HTMLElement,configurable:true},MutationObserver:{value:dom.MutationObserver,configurable:true}})
const {renderHook,act,waitFor,cleanup}=await import('@testing-library/react')
const {getAuth,getAccessToken,useAuthSession}=await import('./auth.ts')
afterEach(()=>{cleanup();dom.localStorage.clear();dom.sessionStorage.clear()})
const session=(id:string)=>({access_token:'token-'+id,refresh_token:'refresh-'+id,token_type:'bearer',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user:{id}})
test('el estado de acceso y getSession comparten el almacenamiento entre pestañas',async()=>{
  const originalFetch=globalThis.fetch
  globalThis.fetch=async()=>Response.json(session('A'))
  const auth=getAuth({apiUrl:'https://api.example.test',supabaseUrl:'https://shared.example.test',publishableKey:'sb_publishable_test',backendReady:true})
  try{
    await auth.auth.signInWithPassword({email:'a@example.test',password:'dummy'})
    const key='sb-shared-auth-token'
    assert.equal(JSON.parse(localStorage.getItem(key)!).user.id,'A')
    localStorage.setItem(key,JSON.stringify(session('B')))
    assert.equal((await auth.auth.getSession()).data.session?.user.id,'B')
  }finally{globalThis.fetch=originalFetch;await auth.auth.dispose()}
})
test('un cierre tardío no reemplaza el acceso posterior emitido por Supabase',async()=>{
  let notify:(_event:string,next:any)=>void=()=>{},finish:()=>void=()=>{}
  const auth={auth:{getSession:async()=>({data:{session:session('A')},error:null}),onAuthStateChange:(callback:any)=>{notify=callback;return {data:{subscription:{unsubscribe(){}}}}},signOut:()=>new Promise<void>(resolve=>{finish=resolve})}} as unknown as SupabaseClient
  const view=renderHook(()=>useAuthSession(auth))
  await waitFor(()=>assert.equal(view.result.current.session?.user.id,'A'))
  let closing:Promise<void>
  await act(async()=>{closing=view.result.current.signOut();notify('SIGNED_IN',session('B'))})
  await act(async()=>{finish();await closing!})
  assert.equal(view.result.current.session?.user.id,'B')
})
test('una caída temporal de renovación no se convierte en cierre definitivo de sesión',async()=>{
  const auth={auth:{refreshSession:async()=>({data:{session:null},error:new AuthRetryableFetchError('Temporalmente inaccesible',503)})}} as unknown as SupabaseClient
  const api=new BedroomApi('https://api.example.test',()=>getAccessToken(auth,'A',true),async()=>Response.json([]))
  await assert.rejects(api.list(),(error:any)=>error instanceof ApiError&&error.status===503)
})

test('una petición de la cuenta anterior se cancela sin cerrar la cuenta nueva',async()=>{
  const auth={auth:{getSession:async()=>({data:{session:session('B')},error:null})}} as unknown as SupabaseClient
  let sent=false
  const api=new BedroomApi('https://api.example.test',()=>getAccessToken(auth,'A'),async()=>{sent=true;return Response.json([])})
  await assert.rejects(api.list(),(error:any)=>error.name==='AbortError')
  assert.equal(sent,false)
})
