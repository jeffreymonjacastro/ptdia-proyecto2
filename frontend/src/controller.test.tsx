import test, { afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { Window } from 'happy-dom'
import { BedroomApi } from './api.ts'
const dom = new Window({url:'http://localhost:5173'})
Object.defineProperties(globalThis, { window:{value:dom,configurable:true}, document:{value:dom.document,configurable:true}, navigator:{value:dom.navigator,configurable:true}, HTMLElement:{value:dom.HTMLElement,configurable:true}, MutationObserver:{value:dom.MutationObserver,configurable:true}, localStorage:{value:dom.localStorage,configurable:true}, sessionStorage:{value:dom.sessionStorage,configurable:true} })
const {renderHook, waitFor, act, cleanup} = await import('@testing-library/react')
const {useRemoteWorkspace} = await import('./useRemoteWorkspace.ts')
afterEach(() => { cleanup(); dom.localStorage.clear(); dom.sessionStorage.clear() })
const fixture = () => JSON.parse(readFileSync(new URL('./fixtures/session.json',import.meta.url),'utf8'))
const user = {id:'account-a',email:'a@example.test'}
const signOut = async () => {}

test('el controlador carga sesiones remotas sin leer el IndexedDB de la demo', async () => {
  const raw = fixture()
  const api = new BedroomApi('https://api.example.test',async()=>'token',async(url:any) => Response.json(String(url).endsWith('/api/generations') ? [raw] : raw))
  const view = renderHook(() => useRemoteWorkspace(api,user,signOut))
  await waitFor(() => assert.equal(view.result.current.workspace?.projects[0].proposals.length,5))
  assert.equal(view.result.current.connected,true)
  assert.equal(view.result.current.workspace!.projects[0].photo.kind,'remote')
  assert.equal(view.result.current.workspace!.projects[0].proposals[0].versions[0].status,'pending')
})

test('aceptar usa el ID remoto y muestra la decisión confirmada al recargar el JSON', async () => {
  const raw = fixture()
  let sent = ''
  const api = new BedroomApi('https://api.example.test',async()=>'token',async(url:any,init:any) => {
    if (init.method === 'PUT') { sent=String(url);raw.variations[0].versions[0].decision='accepted';raw.revision++;return Response.json({session_id:raw.id,version_id:raw.variations[0].current_version_id,decision:'accepted'}) }
    return Response.json(String(url).endsWith('/api/generations') ? [raw] : raw)
  })
  const view = renderHook(() => useRemoteWorkspace(api,user,signOut))
  await waitFor(() => assert.equal(view.result.current.workspace?.projects[0].proposals.length,5))
  await act(async()=>{ await view.result.current.onAction({type:'decide',position:1,versionId:'00000000-0000-0000-0000-000000000021',status:'accepted',reason:''}) })
  assert.ok(sent.endsWith('/decisions/00000000-0000-0000-0000-000000000021'))
  assert.equal(view.result.current.workspace!.projects[0].proposals[0].versions[0].status,'accepted')
})

test('el polling recupera un lote inicial sin inventar imágenes mientras el job está pendiente', async () => {
  const ready = fixture()
  let finished = false
  const initial = structuredClone(ready)
  initial.status='generating'
  initial.variations.forEach((v:any)=>{v.current_version_id=null;v.versions=[]})
  initial.jobs=[{id:'initial-job',kind:'initial',status:'queued',position:null,progress:0,error:null}]
  const api = new BedroomApi('https://api.example.test',async()=>'token',async(url:any)=>{
    if(String(url).includes('/api/jobs/')) {finished=true;return Response.json({id:'initial-job',kind:'initial',status:'succeeded',position:null,progress:100,error:null})}
    if(String(url).endsWith('/api/generations')) return Response.json([initial])
    return Response.json(finished? ready:initial)
  })
  const view = renderHook(()=>useRemoteWorkspace(api,user,signOut))
  await waitFor(()=>assert.equal(view.result.current.workspace?.projects[0].status,'generating'))
  assert.equal(view.result.current.workspace!.projects[0].proposals.length,0)
  await waitFor(()=>assert.equal(view.result.current.workspace?.projects[0].proposals.length,5),{timeout:6000})
})

test('un rechazo confirmado mantiene el job recuperable si falla la lectura inmediatamente posterior', async () => {
  const raw=fixture()
  let rejected=false,failRead=false
  const job={id:'regeneration-job',kind:'regenerate',status:'queued',position:1,progress:0,error:null}
  const api=new BedroomApi('https://api.example.test',async()=>'token',async(url:any,init:any)=>{
    if(init.method==='PUT') { rejected=true;failRead=true;raw.variations[0].versions[0].decision='rejected';return Response.json({session_id:raw.id,version_id:raw.variations[0].current_version_id,decision:'rejected',job_id:job.id},{status:202}) }
    if(String(url).includes('/api/jobs/'))return Response.json({...job,status:'running'})
    if(String(url).endsWith('/api/generations'))return Response.json([raw])
    if(failRead){failRead=false;return Response.json({detail:'database_unavailable'},{status:503})}
    return Response.json({...raw,jobs:rejected?[job]:[]})
  })
  const view=renderHook(()=>useRemoteWorkspace(api,user,signOut))
  await waitFor(()=>assert.equal(view.result.current.workspace?.projects[0].proposals.length,5))
  await act(async()=>{await view.result.current.onAction({type:'decide',position:1,versionId:raw.variations[0].current_version_id,status:'rejected',reason:'Conservar techo'})})
  assert.equal(view.result.current.workspace!.projects[0].jobs![0].id,job.id)
  assert.equal(view.result.current.workspace!.projects[0].proposals[0].generation,'generating')
})

test('un conflicto 409 recupera la versión vigente antes de permitir otra decisión',async()=>{
  const raw=fixture(),old=raw.variations[0].current_version_id
  const api=new BedroomApi('https://api.example.test',async()=>'t',async(url:any,init:any)=>{
    if(init.method==='PUT'){
      const slot=raw.variations[0];slot.versions.push({...slot.versions[0],id:'new-version',number:2});slot.current_version_id='new-version';raw.revision++
      return Response.json({detail:'stale_version_or_invalid_state'},{status:409})
    }
    return Response.json(String(url).endsWith('/api/generations')?[raw]:raw)
  })
  const view=renderHook(()=>useRemoteWorkspace(api,user,signOut))
  await waitFor(()=>assert.equal(view.result.current.workspace?.projects[0].proposals.length,5))
  await act(async()=>{await assert.rejects(view.result.current.onAction({type:'decide',position:1,versionId:old,status:'accepted',reason:''}))})
  assert.equal(view.result.current.workspace!.projects[0].proposals[0].currentVersionId,'new-version')
})
for(const mutation of ['create','delete'] as const)test(`un historial iniciado antes de ${mutation} no revierte la mutación confirmada`,async()=>{
  const raw=fixture(),created={...fixture(),id:'created-session',status:'generating',variations:[],jobs:[]}
  let listCalls=0,resolveList:(response:Response)=>void=()=>{}
  const api=new BedroomApi('https://api.example.test',async()=>'t',async(url:any,init:any)=>{
    if(init.method==='POST')return Response.json({session_id:created.id,job_id:'initial-job'},{status:202})
    if(init.method==='DELETE')return Response.json({session_id:raw.id,status:'deleting'},{status:202})
    if(String(url).endsWith('/api/generations')){listCalls++;if(listCalls===2)return new Promise<Response>(resolve=>{resolveList=resolve});return Response.json([raw])}
    return Response.json(String(url).endsWith(created.id)?created:raw)
  })
  const view=renderHook(()=>useRemoteWorkspace(api,user,signOut))
  await waitFor(()=>assert.equal(view.result.current.workspace?.projects[0].proposals.length,5))
  await act(async()=>{await view.result.current.refresh()})
  await waitFor(()=>assert.equal(listCalls,2))
  await act(async()=>{
    if(mutation==='delete')await view.result.current.remove(raw.id)
    else await view.result.current.create({client:'Nuevo',room:'Dormitorio',preferences:'',consent:true,bedroomConfirmed:true,photo:{kind:'upload',name:'foto.png',blob:new Blob(['image']),width:640,height:480}})
  })
  await act(async()=>{resolveList(Response.json([raw]));await new Promise(resolve=>setTimeout(resolve,0))})
  const ids=view.result.current.workspace!.projects.map(p=>p.id)
  if(mutation==='delete')assert.ok(!ids.includes(raw.id))
  else{assert.ok(ids.includes(created.id));assert.equal(view.result.current.workspace!.activeId,created.id)}
})
test('la pausa confirmada conserva el resumen y bloquea la edición aunque falle la lectura posterior',async()=>{
  const raw=fixture();raw.variations.forEach((slot:any)=>slot.versions[0].decision='accepted')
  raw.summary={revision:raw.revision,summary:'Resumen guardado',accepted_version_ids:raw.variations.map((slot:any)=>slot.current_version_id),rejected_version_ids:[],historical_rejections:[]}
  let paused=false
  const api=new BedroomApi('https://api.example.test',async()=>'t',async(url:any,init:any)=>{
    if(init.method==='PATCH'){paused=true;return Response.json({id:raw.id,status:'paused'})}
    if(paused)return Response.json({detail:'database_unavailable'},{status:503})
    return Response.json(String(url).endsWith('/api/generations')?[raw]:raw)
  })
  const view=renderHook(()=>useRemoteWorkspace(api,user,signOut))
  await waitFor(()=>assert.equal(view.result.current.workspace?.projects[0].summary?.text,'Resumen guardado'))
  await act(async()=>{await view.result.current.onAction({type:'pause'})})
  assert.equal(view.result.current.workspace!.projects[0].status,'paused')
  assert.equal(view.result.current.workspace!.projects[0].summary?.text,'Resumen guardado')
})
test('un resumen guardado devuelto por POST se presenta aunque falle el GET siguiente',async()=>{
  const raw=fixture();raw.variations.forEach((slot:any)=>slot.versions[0].decision='accepted')
  const summary={revision:raw.revision,summary:'Resumen confirmado por POST',accepted_version_ids:raw.variations.map((slot:any)=>slot.current_version_id),rejected_version_ids:[],historical_rejections:[]}
  let requested=false
  const api=new BedroomApi('https://api.example.test',async()=>'t',async(url:any,init:any)=>{
    if(init.method==='POST'){requested=true;return Response.json(summary)}
    if(requested)return Response.json({detail:'database_unavailable'},{status:503})
    return Response.json(String(url).endsWith('/api/generations')?[raw]:raw)
  })
  const view=renderHook(()=>useRemoteWorkspace(api,user,signOut))
  await waitFor(()=>assert.equal(view.result.current.workspace?.projects[0].proposals.length,5))
  await act(async()=>{await view.result.current.onAction({type:'summarize'})})
  assert.equal(view.result.current.workspace!.projects[0].summary?.text,summary.summary)
})
