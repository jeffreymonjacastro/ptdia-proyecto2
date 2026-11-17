import test from 'node:test'
import assert from 'node:assert/strict'
import { BedroomApi, ApiError } from './api.ts'

const origin = 'https://bedroom.example.test'
test('cada petición consulta el bearer vigente y añade la cabecera ngrok', async () => {
  let token = 'primero'
  const sent: Headers[] = []
  const api = new BedroomApi(origin, async () => token, async (_url: any, init: any) => { sent.push(new Headers(init.headers)); return Response.json([]) })
  await api.list()
  token = 'renovado'
  await api.list()
  assert.equal(sent[0].get('Authorization'), 'Bearer primero')
  assert.equal(sent[1].get('Authorization'), 'Bearer renovado')
  assert.equal(sent[1].get('ngrok-skip-browser-warning'), 'true')
})
test('una decisión usa PUT, decision en JSON y una clave estable tras fallo de red', async () => {
  const attempts: {url: string; init: RequestInit}[] = []
  const api = new BedroomApi(origin, async () => 'token', async (url: any, init: any) => {
    attempts.push({url: String(url), init})
    if (attempts.length === 1) throw new TypeError('Network error')
    return Response.json({ session_id: 'sesion', version_id: 'version', decision: 'rejected', job_id: 'job' }, { status: 202 })
  })
  await assert.rejects(api.decide('sesion', 'version', 'rejected', 'Conservar techo'))
  await api.decide('sesion', 'version', 'rejected', 'Conservar techo')
  assert.equal(attempts[1].url, origin + '/api/generations/sesion/decisions/version')
  assert.equal(attempts[1].init.method, 'PUT')
  assert.deepEqual(JSON.parse(String(attempts[1].init.body)), { decision: 'rejected', reason: 'Conservar techo' })
  const key = new Headers(attempts[0].init.headers).get('Idempotency-Key')
  assert.ok(key)
  assert.equal(new Headers(attempts[1].init.headers).get('Idempotency-Key'), key)
})
test('una nueva acción tras éxito obtiene otra clave y un rechazo vacío no se envía', async () => {
  const headers: Headers[] = []
  const api = new BedroomApi(origin, async () => 't', async (_url: any, init: any) => { headers.push(new Headers(init.headers)); return Response.json({session_id:'s',version_id:'v',decision:'accepted'}) })
  await assert.rejects(api.decide('s', 'v', 'rejected', '   '), /motivo/)
  await api.decide('s', 'v', 'accepted', '')
  await api.decide('s', 'v', 'accepted', '')
  assert.equal(headers.length, 2)
  assert.notEqual(headers[0].get('Idempotency-Key'), headers[1].get('Idempotency-Key'))
})
test('el upload es multipart y no fija Content-Type ni envía metadatos locales como contrato', async () => {
  let request: RequestInit = {}
  const api = new BedroomApi(origin, async () => 't', async (_url: any, init: any) => { request = init; return Response.json({session_id:'s',job_id:'j'}, {status:202}) })
  await api.upload(new File(['photo'], 'dormitorio.png', { type: 'image/png' }), 'Conservar cama', true)
  assert.equal(new Headers(request.headers).has('Content-Type'), false)
  const body = request.body as FormData
  assert.equal(body.get('consent'), 'true')
  assert.equal(body.get('preferences'), 'Conservar cama')
  assert.ok(body.get('image') instanceof Blob)
  assert.equal(body.has('client'), false)
})
test('la imagen privada usa bearer y nunca lo envía a un origen ajeno', async () => {
  let calls = 0
  const api = new BedroomApi(origin, async () => 'token', async (_url: any, init: any) => { calls++; assert.equal(new Headers(init.headers).get('Authorization'), 'Bearer token'); return new Response('image', {headers:{'Content-Type':'image/png'}}) })
  const image = await api.image('/api/generations/s/original')
  assert.equal(image.type, 'image/png')
  await assert.rejects(api.image('https://other.example.test/private'), /origen/)
  assert.equal(calls, 1)
})
test('los errores HTTP admiten detail string o lista y el HTML de ngrok no es JSON', async () => {
  const response = [Response.json({detail:[{msg:'foto inválida'}]}, {status:422}), new Response('<html>ngrok</html>', {headers:{'Content-Type':'text/html'}})]
  const api = new BedroomApi(origin, async () => 't', async () => response.shift()!)
  await assert.rejects(api.list(), (error: any) => error instanceof ApiError && error.status === 422 && error.message.includes('foto inválida'))
  await assert.rejects(api.list(), /JSON|conexión|ngrok/i)
})

test('un 401 renueva el token una sola vez antes de repetir la lectura', async () => {
  const sent:string[]=[]
  const api=new BedroomApi(origin,async(refresh)=>refresh?'nuevo':'viejo',async(_url:any,init:any)=>{
    sent.push(new Headers(init.headers).get('Authorization')!)
    return sent.length===1 ? Response.json({detail:'unauthorized'},{status:401}) : Response.json([])
  })
  await api.list()
  assert.deepEqual(sent,['Bearer viejo','Bearer nuevo'])
})

test('un JSON de alta inválido conserva la clave de la escritura incierta', async () => {
  const keys:string[]=[]
  const api=new BedroomApi(origin,async()=>'token',async(_url:any,init:any)=>{
    keys.push(new Headers(init.headers).get('Idempotency-Key')!)
    return Response.json(keys.length===1 ? {} : {session_id:'s',job_id:'j'},{status:202})
  })
  const photo=new File(['image'],'foto.png',{type:'image/png'})
  await assert.rejects(api.upload(photo,'',true),/respuesta|identificador|JSON/i)
  await api.upload(photo,'',true)
  assert.equal(keys[0],keys[1])
})

test('el transporte nativo conserva el receptor global que requiere fetch en el navegador', async () => {
  const nativeLike = function(this:unknown,_url:RequestInfo|URL,_init?:RequestInit) {
    assert.equal(this,globalThis)
    return Promise.resolve(Response.json([]))
  } as typeof fetch
  const api=new BedroomApi(origin,async()=>'token',nativeLike)
  await api.list()
})
