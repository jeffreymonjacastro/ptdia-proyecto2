import { parseJob, parseSession, parseSessionItem, type SessionItem } from './remote.ts'

export class ApiError extends Error {
  status: number
  code: string
  constructor(status: number, code: string, message = code) { super(message); this.status = status; this.code = code; this.name = 'ApiError' }
}
const messages: Record<string, string> = {
  unauthorized: 'Tu sesión ha vencido. Vuelve a iniciar sesión.', not_found: 'Este proyecto o archivo ya no está disponible.',
  stale_version_or_invalid_state: 'La propuesta cambió. Se actualizará el proyecto antes de continuar.', regeneration_in_progress: 'Esta propuesta ya se está regenerando.',
  invalid_session_state: 'Esta acción no está disponible mientras el proyecto está en ese estado.', five_acceptances_required: 'Acepta las cinco propuestas actuales antes de pedir el resumen.',
  upload_too_large: 'La fotografía supera los 10 MB permitidos.', too_many_pixels: 'La fotografía supera los 25 megapíxeles.', invalid_image: 'Usa una fotografía JPG, PNG o WebP estática y válida.',
  consent_required: 'Autoriza el uso de la fotografía antes de continuar.', storage_unavailable: 'El almacenamiento no está disponible. Conserva la acción y vuelve a intentar.',
  database_unavailable: 'No se pudo acceder al historial. Vuelve a intentar cuando se recupere la conexión.', idempotency_conflict: 'Esta acción cambió. Actualiza el proyecto antes de intentarlo de nuevo.',
}
export class BedroomApi {
  readonly origin: string
  private intents = new Map<string, string>()
  private token: (refresh?: boolean) => Promise<string | null>
  private fetcher: typeof fetch
  constructor(url: string, token: (refresh?: boolean) => Promise<string | null>, fetcher: typeof fetch = fetch) {
    this.token = token
    this.fetcher = fetcher.bind(globalThis)
    const parsed = new URL(url)
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error('La URL del backend no es válida.')
    this.origin = parsed.origin
  }
  private async request(path: string, init: RequestInit = {}, binary = false): Promise<any> {
    const url = new URL(path, this.origin)
    if (url.origin !== this.origin) throw new Error('La imagen o petición pertenece a otro origen.')
    const signal = init.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(45000)]) : AbortSignal.timeout(45000)
    const send = async (refresh = false) => {
      const token = await this.token(refresh)
      if (!token) throw new ApiError(401, 'unauthorized', messages.unauthorized)
      const headers = new Headers(init.headers)
      headers.set('Authorization', `Bearer ${token}`)
      headers.set('ngrok-skip-browser-warning', 'true')
      try { return await this.fetcher(url.toString(), { ...init, signal, headers, cache: 'no-store' }) }
      catch (error) {
        if (error instanceof Error && error.name === 'TimeoutError') throw new ApiError(503, 'network_timeout', 'La conexión tardó demasiado. Puedes reintentar la misma acción.')
        throw error
      }
    }
    let response = await send()
    if (response.status === 401) response = await send(true)
    if (response.ok && binary) {
      if (!/^image\/(png|jpeg|webp)(;|$)/i.test(response.headers.get('Content-Type') ?? '')) throw new Error('El backend no devolvió una imagen válida. Comprueba la conexión ngrok.')
      return response.blob()
    }
    let data: any
    try { data = await response.json() }
    catch { throw new ApiError(response.status || 503, 'invalid_json', 'La conexión no devolvió JSON. Comprueba la URL del backend y el túnel ngrok.') }
    if (!response.ok) {
      const code = typeof data?.detail === 'string' ? data.detail : 'validation_error'
      const detail = Array.isArray(data?.detail) ? data.detail.map((d: any) => d.msg || 'Dato inválido').join('. ') : undefined
      throw new ApiError(response.status, code, detail || messages[code] || `No se completó la petición (HTTP ${response.status}).`)
    }
    return data
  }
  private async write(method: string, path: string, body?: BodyInit, identity = '', json = false, valid?: (data:any)=>boolean) {
    const intent = JSON.stringify([method, path, identity])
    const key = this.intents.get(intent) ?? crypto.randomUUID()
    this.intents.set(intent, key)
    const headers = new Headers({ 'Idempotency-Key': key })
    if (json) headers.set('Content-Type', 'application/json')
    try {
      const result = await this.request(path, { method, body, headers })
      if (valid && !valid(result)) throw new ApiError(502, 'invalid_response', 'El backend devolvió un JSON sin los identificadores esperados. Reintenta para recuperar la respuesta de la misma acción.')
      this.intents.delete(intent)
      return result
    } catch (error) {
      if (error instanceof ApiError && error.status < 500 && error.code !== 'invalid_json') this.intents.delete(intent)
      throw error
    }
  }
  async list(signal?: AbortSignal): Promise<SessionItem[]> {
    const data = await this.request('/api/generations', { signal })
    if (!Array.isArray(data)) throw new Error('El backend devolvió un historial inválido.')
    return data.map(parseSessionItem)
  }
  async detail(id: string, signal?: AbortSignal) { return parseSession(await this.request(`/api/generations/${encodeURIComponent(id)}`, { signal })) }
  async job(id: string, signal?: AbortSignal) { return parseJob(await this.request(`/api/jobs/${encodeURIComponent(id)}`, { signal })) }
  async image(path: string, signal?: AbortSignal): Promise<Blob> { return this.request(path, { signal }, true) }
  async upload(photo: File | Blob, preferences: string, consent: boolean) {
    if (!consent) throw new Error('Necesitamos tu autorización para usar esta fotografía.')
    const digest = await crypto.subtle.digest('SHA-256', await photo.arrayBuffer())
    const fingerprint = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
    const body = new FormData()
    body.set('image', photo, photo instanceof File ? photo.name : 'dormitorio.png')
    body.set('preferences', preferences)
    body.set('consent', 'true')
    return this.write('POST', '/api/generations', body, JSON.stringify([fingerprint, preferences]), false, data => !!data && typeof data.session_id === 'string' && typeof data.job_id === 'string')
  }
  async decide(id: string, version: string, status: 'accepted' | 'rejected', reason: string) {
    if (status === 'rejected' && !reason.trim()) throw new Error('Indica el motivo del rechazo.')
    const body = JSON.stringify({ decision: status, ...(reason.trim() ? { reason: reason.trim() } : {}) })
    return this.write('PUT', `/api/generations/${encodeURIComponent(id)}/decisions/${encodeURIComponent(version)}`, body, body, true, data => !!data && data.session_id === id && data.version_id === version && data.decision === status)
  }
  async action(id: string, action: 'summary' | 'retry' | 'confirm-bedroom', position?: number) {
    const path = position ? `variations/${position}/retry` : action
    return this.write('POST', `/api/generations/${encodeURIComponent(id)}/${path}`, undefined, '', false, data => !!data && ((data.session_id === id && typeof data.job_id === 'string') || (action === 'summary' && typeof data.summary === 'string' && Number.isSafeInteger(data.revision))))
  }
  async pause(id: string, paused: boolean) { return this.request(`/api/generations/${encodeURIComponent(id)}`, { method: 'PATCH', headers: {'Content-Type':'application/json'}, body: JSON.stringify({paused}) }) }
  async delete(id: string) { return this.request(`/api/generations/${encodeURIComponent(id)}`, {method:'DELETE'}) }
}
