import { useCallback, useEffect, useRef, useState } from 'react'
import { BedroomApi, ApiError } from './api.ts'
import { activeJobs, toProject, parseSummary, currentSummary, type ProjectMeta, type SessionItem } from './remote.ts'
import type { Workspace } from './storage.ts'
import type { Job, Project, ProjectAction, ProjectInput } from './domain.ts'

type Account = { id: string; email?: string }
export type ActionHandler = (action: ProjectAction) => void | Promise<void>
export type RemoteController = ReturnType<typeof useRemoteWorkspace>
const message = (error: unknown) => error instanceof Error ? error.message : 'No se pudo completar la operación.'
const aborted = (error: unknown) => error instanceof Error && error.name === 'AbortError'

export function useRemoteWorkspace(api: BedroomApi, account: Account, signOut: () => Promise<void>) {
  const [workspace, setWorkspace] = useState<Workspace>()
  const [storageError, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [refreshVersion, setRefreshVersion] = useState(0)
  const alive = useRef(true)
  const state = useRef(workspace)
  state.current = workspace
  const sequences = useRef(new Map<string, number>())
  const listEpoch = useRef(0)
  const working = useRef(new Set<string>())
  const metaKey = `bedroom-project-labels:${account.id}`
  const activeKey = `bedroom-active:${account.id}`
  const metadata = useRef<Record<string, ProjectMeta>>({})
  useEffect(() => {
    alive.current = true
    try {
      const stored = JSON.parse(localStorage.getItem(metaKey) || '{}')
      metadata.current = Object.fromEntries(Object.entries(stored).filter(([, value]) => value && typeof (value as ProjectMeta).client === 'string' && typeof (value as ProjectMeta).room === 'string')) as Record<string, ProjectMeta>
    } catch { metadata.current = {} }
    return () => { alive.current = false }
  }, [metaKey])
  const report = useCallback((error: unknown) => {
    if (!alive.current || aborted(error)) return
    setError(message(error))
    if (error instanceof ApiError && error.status === 401) void signOut()
  }, [signOut])
  const stub = useCallback((item: SessionItem): Project => ({
    id: item.id, client: metadata.current[item.id]?.client || `Sesión ${new Date(item.created_at).toLocaleDateString('es-PE')}`,
    room: metadata.current[item.id]?.room || `Dormitorio · ${item.id.slice(0, 8)}`, preferences: '',
    photo: { kind:'remote', name:'dormitorio-original', url:`/api/generations/${item.id}/original` },
    createdAt: item.created_at, status: item.status, revision: item.revision, proposals: [], events: [], messages: [],
  }), [])
  const loadSession = useCallback(async (id: string, signal?: AbortSignal) => {
    const sequence = (sequences.current.get(id) || 0) + 1
    sequences.current.set(id, sequence)
    const session = await api.detail(id, signal)
    if (!alive.current || signal?.aborted || sequences.current.get(id) !== sequence) return
    const project = toProject(session, metadata.current[id])
    setWorkspace(previous => previous && { ...previous, projects: previous.projects.map(p => p.id === id ? project : p) })
    setError('')
    return project
  }, [api])
  const refresh = useCallback(async () => { setError(''); setRefreshVersion(value => value + 1) }, [])
  useEffect(() => {
    const abort = new AbortController()
    const epoch=listEpoch.current
    void api.list(abort.signal).then(items => {
      if (abort.signal.aborted || !alive.current || epoch!==listEpoch.current) return
      let selected: string | null = null
      try { selected = sessionStorage.getItem(activeKey) } catch { /* Selección efímera si no hay storage. */ }
      setWorkspace(previous => {
        const projects = items.map(item => previous?.projects.find(p => p.id === item.id) ?? stub(item))
        const candidate = previous?.activeId ?? selected
        return { schema:1, projects, designer:account.email || 'Diseñador', activeId:projects.some(p => p.id === candidate) ? candidate : projects[0]?.id ?? null }
      })
    }).catch(error => {
      if (!abort.signal.aborted) { report(error); setWorkspace(previous => previous ?? {schema:1,projects:[],activeId:null,designer:account.email || 'Diseñador'}) }
    })
    return () => abort.abort()
  }, [api, activeKey, account.email, refreshVersion, report, stub])
  const activeId = workspace?.activeId
  useEffect(() => {
    if (!activeId) return
    try { sessionStorage.setItem(activeKey, activeId) } catch { /* No se guardan fotos ni decisiones aquí. */ }
    const abort = new AbortController()
    void loadSession(activeId, abort.signal).catch(error => { if (!abort.signal.aborted) report(error) })
    return () => abort.abort()
  }, [activeId, activeKey, loadSession, report, refreshVersion])
  const project = workspace?.projects.find(p => p.id === activeId)
  const jobIds = project ? activeJobs(project).map(j => j.id).join(',') : ''
  useEffect(() => {
    if (!activeId || !jobIds) return
    const abort = new AbortController()
    let timeout: ReturnType<typeof setTimeout>
    async function poll() {
      try {
        await Promise.all(jobIds.split(',').map(id => api.job(id, abort.signal)))
        await loadSession(activeId!, abort.signal)
      } catch (error) { if (!abort.signal.aborted) report(error) }
      if (!abort.signal.aborted) timeout = setTimeout(poll, 2500)
    }
    timeout = setTimeout(poll, 2500)
    return () => { abort.abort(); clearTimeout(timeout) }
  }, [api, activeId, jobIds, loadSession, report])
  const run = useCallback(async (key: string, operation: () => Promise<void>, sessionId?:string) => {
    if (working.current.has(key)) return
    working.current.add(key); setSaving(true); setError('')
    try { await operation() }
    catch (error) {
      if (error instanceof ApiError && error.status===409 && sessionId && alive.current) {
        try { await loadSession(sessionId) } catch { /* Se conserva el conflicto original y la recuperación manual. */ }
      }
      report(error); throw error
    }
    finally { working.current.delete(key); if (alive.current) setSaving(working.current.size > 0) }
  }, [report,loadSession])
  const reloadAfterWrite = useCallback(async (id: string) => {
    try { await loadSession(id) } catch (error) {
      report(error)
      if (alive.current && !(error instanceof ApiError && error.status === 401)) setError(`La acción se guardó, pero falta actualizar la vista. Pulsa Reintentar. ${message(error)}`)
    }
  }, [loadSession, report])
  const applyAck = useCallback((id:string, result:any, kind?:Job['kind'], position:number|null=null) => {
    if (!alive.current) return
    sequences.current.set(id,(sequences.current.get(id)||0)+1)
    setWorkspace(previous => previous && { ...previous, projects:previous.projects.map(p => {
      if (p.id !== id) return p
      const known=p.jobs?.find(j=>j.id===result.job_id)
      const job:Job|undefined = kind && typeof result.job_id==='string' ? known ?? {id:result.job_id,kind,status:'queued',position,progress:0,error:null,luxury_variant:result.luxury_variant??null} : undefined
      const running=job && ['queued','running'].includes(job.status)
      return { ...p, status:kind==='initial' ? 'generating' : p.status,
        summary:kind==='summary' && typeof result.summary==='string' ? currentSummary(parseSummary(result),p) : p.summary,
        jobs:job ? [job,...(p.jobs??[]).filter(j=>j.id!==job.id)] : p.jobs,
        proposals:p.proposals.map(slot=>({ ...slot,
          generation:running && kind==='regenerate' && slot.position===position ? 'generating' : slot.generation,
          requestedLuxuryVariant:running && slot.position===position ? job.luxury_variant ?? undefined : slot.requestedLuxuryVariant,
          versions:slot.versions.map(v=>v.id===result.version_id && ['accepted','rejected'].includes(result.decision) ? {...v,status:result.decision as 'accepted'|'rejected'} : v),
        })),
      }
    }) })
  }, [])
  const onAction = useCallback(async (action: ProjectAction) => {
    const id = state.current?.activeId
    if (!id) return
    const key = `${id}:${'position' in action ? action.position : action.type}`
    await run(key, async () => {
      let invalidates = ['decide','retry'].includes(action.type)
      if (action.type === 'decide') applyAck(id,await api.decide(id, action.versionId, action.status, action.reason),action.status==='rejected' ? 'regenerate' : undefined,action.position)
      else if (action.type === 'switch-luxury') {
        const ack = await api.switchLuxury(id, action.versionId, action.variant)
        invalidates = !!ack.job_id
        applyAck(id,{...ack,luxury_variant:action.variant},'regenerate',action.position)
      }
      else if (action.type === 'retry') applyAck(id,await api.action(id, 'retry', action.position),'regenerate',action.position)
      else if (action.type === 'summarize') applyAck(id,await api.action(id, 'summary'),'summary')
      else if (action.type === 'pause' || action.type === 'resume') {
        const ack=await api.pause(id, action.type === 'pause')
        sequences.current.set(id,(sequences.current.get(id)||0)+1)
        if(alive.current)setWorkspace(previous=>previous&&{...previous,projects:previous.projects.map(p=>p.id===id?{...p,status:ack.status}:p)})
      }
      else throw new Error('Esta acción solo está disponible en la demostración.')
      setWorkspace(previous => previous && { ...previous, projects: previous.projects.map(p => p.id === id ? { ...p, summary: invalidates ? undefined : p.summary } : p) })
      await reloadAfterWrite(id)
    },id)
  }, [api, run, reloadAfterWrite, applyAck])
  const create = useCallback(async (input: ProjectInput) => {
    if (input.photo.kind !== 'upload' || !input.bedroomConfirmed || !input.consent) throw new Error('Selecciona y autoriza una fotografía de dormitorio.')
    const photo=input.photo.blob
    await run('create', async () => {
      const result = await api.upload(photo, input.preferences, input.consent, input.luxuryModel)
      if (!result || typeof result.session_id !== 'string' || typeof result.job_id !== 'string') throw new Error('El backend no devolvió el identificador del proyecto.')
      const id = result.session_id
      listEpoch.current++
      metadata.current[id] = { client:input.client.trim(), room:input.room.trim() || 'Dormitorio principal' }
      try { localStorage.setItem(metaKey, JSON.stringify(metadata.current)) } catch { setError('El proyecto está guardado en el servidor, pero su nombre solo se conservará en esta vista.') }
      const next = stub({id,status:'generating',revision:0,created_at:new Date().toISOString()})
      setWorkspace(previous => previous && { ...previous, projects:[next, ...previous.projects.filter(p => p.id !== id)], activeId:id })
      applyAck(id,result,'initial')
    })
  }, [api, metaKey, run, stub, applyAck])
  const remove = useCallback(async (id: string) => {
    await run(`delete:${id}`, async () => {
      await api.delete(id)
      listEpoch.current++
      sequences.current.set(id,(sequences.current.get(id)||0)+1)
      delete metadata.current[id]
      try { localStorage.setItem(metaKey, JSON.stringify(metadata.current)) } catch { /* El servidor confirma el borrado. */ }
      setWorkspace(previous => {
        if (!previous) return previous
        const projects = previous.projects.filter(p => p.id !== id)
        return { ...previous, projects, activeId:previous.activeId === id ? projects[0]?.id ?? null : previous.activeId }
      })
    })
  }, [api, metaKey, run])
  const initial = useCallback(async (action: 'retry' | 'confirm-bedroom') => {
    const id = state.current?.activeId
    if (!id) return
    await run(`initial:${id}`, async () => { applyAck(id,await api.action(id, action),'initial'); await reloadAfterWrite(id) },id)
  }, [api, run, reloadAfterWrite, applyAck])
  return { connected:true as const, workspace, setWorkspace, saving, storageError, retrySave:refresh, onAction, create, remove, initial, refresh, signOut }
}
