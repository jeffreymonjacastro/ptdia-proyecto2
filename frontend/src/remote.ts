import { STYLE_IDS, currentVersion, type Decision, type Job, type Project, type Style, type Summary } from './domain.ts'
import type { LuxuryVariant } from './domain.ts'

export type RemoteDecision = { version_id: string; decision: 'accepted' | 'rejected'; reason: string | null; created_at: string }
export type RemoteVersion = {
  id: string; number: number; prompt: string; seed: string; description: string; decision: 'accepted' | 'rejected' | null
  reason: string | null; settings: Record<string, unknown>; provenance: Record<string, unknown>; created_at: string
  size_bytes: number; image_url: string; decisions: RemoteDecision[]
}
export type RemoteVariation = { position: number; style_id: Style; label: string; current_version_id: string | null; versions: RemoteVersion[]; luxury_variant?:LuxuryVariant|null; luxury_variants?:{id:LuxuryVariant;label:string}[] }
export type RemoteSummary = { revision: number; accepted_version_ids: string[]; rejected_version_ids: string[]; historical_rejections: {version_id:string; reason:string|null; created_at:string}[]; summary: string }
export type SessionItem = { id: string; status: Project['status']; revision: number; created_at: string }
export type RemoteSession = SessionItem & { preferences: string; original_image_url: string; variations: RemoteVariation[]; summary: RemoteSummary | null; jobs: Job[] }
export type ProjectMeta = { client: string; room: string }
const states = ['generating', 'needs_confirmation', 'rejected', 'failed', 'ready', 'paused', 'completed']
const text = (value: unknown): value is string => typeof value === 'string'
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every(text)
const decision = (value: unknown) => value === 'accepted' || value === 'rejected'
const luxuryVariant = (value: unknown): value is LuxuryVariant => value === 'custom' || value === 'pretrained'
const problem = () => new Error('El backend devolvió una respuesta de sesión inválida o un lote incompleto.')

export function parseSessionItem(value: unknown): SessionItem {
  const p = value as SessionItem
  if (!p || !text(p.id) || !p.id || !states.includes(p.status) || !Number.isSafeInteger(p.revision) || !text(p.created_at)) throw problem()
  return p
}
export function parseJob(value: unknown): Job {
  const job = value as Job
  if (!job || !text(job.id) || !['initial', 'regenerate', 'summary', 'delete'].includes(job.kind)
    || !['queued', 'running', 'succeeded', 'failed'].includes(job.status) || !Number.isFinite(job.progress)
    || !(job.position === null || (Number.isInteger(job.position) && job.position >= 1 && job.position <= 5))
    || !(job.error === null || text(job.error)) || (job.luxury_variant != null && !luxuryVariant(job.luxury_variant))) throw problem()
  return job
}
export function parseSession(value: unknown): RemoteSession {
  const p = value as RemoteSession
  parseSessionItem(p)
  if (!text(p.preferences) || !text(p.original_image_url) || !Array.isArray(p.variations) || !Array.isArray(p.jobs)) throw problem()
  p.jobs.forEach(parseJob)
  const positions = new Set<number>()
  const versionIds = new Set<string>()
  for (const slot of p.variations) {
    if (!Number.isInteger(slot.position) || positions.has(slot.position) || slot.position < 1 || slot.position > 5
      || slot.style_id !== STYLE_IDS[slot.position - 1] || !text(slot.label) || !Array.isArray(slot.versions)) throw problem()
    positions.add(slot.position)
    if (slot.luxury_variant != null && !luxuryVariant(slot.luxury_variant)) throw problem()
    if (slot.luxury_variants !== undefined && (!Array.isArray(slot.luxury_variants) || slot.luxury_variants.some(option => !option || !luxuryVariant(option.id) || !text(option.label)))) throw problem()
    for (const v of slot.versions) {
      if (!text(v.id) || versionIds.has(v.id) || !Number.isInteger(v.number) || v.number < 1
        || !text(v.prompt) || !text(v.seed) || !text(v.description) || !(v.decision === null || decision(v.decision))
        || !(v.reason === null || text(v.reason)) || !text(v.created_at) || !text(v.image_url) || !v.image_url.trim()
        || !Number.isFinite(v.size_bytes) || !Array.isArray(v.decisions) || !v.settings || !v.provenance) throw problem()
      versionIds.add(v.id)
      for (const event of v.decisions) if (event.version_id !== v.id || !decision(event.decision) || !(event.reason === null || text(event.reason)) || !text(event.created_at)) throw problem()
    }
    if (slot.current_version_id !== null && !slot.versions.some(v => v.id === slot.current_version_id)) throw problem()
  }
  if (['ready', 'paused', 'completed'].includes(p.status) && (positions.size !== 5 || p.variations.some(v => !v.current_version_id))) throw problem()
  if (p.summary !== null) {
    const s = parseSummary(p.summary)
    if ([...s.accepted_version_ids, ...s.rejected_version_ids].some(id => !versionIds.has(id))
      || s.historical_rejections.some(e => !versionIds.has(e.version_id))) throw problem()
  }
  return p
}
export function parseSummary(value:unknown):RemoteSummary {
  const s=value as RemoteSummary
  if (!s || !Number.isSafeInteger(s.revision) || !text(s.summary) || !strings(s.accepted_version_ids)
    || !strings(s.rejected_version_ids) || !Array.isArray(s.historical_rejections)
    || s.historical_rejections.some(e=>!e || !text(e.version_id) || !(e.reason===null || text(e.reason)) || !text(e.created_at))) throw problem()
  return s
}
export function currentSummary(summary:RemoteSummary|null, project:Pick<Project,'revision'|'proposals'>):Summary|undefined {
  const acceptedIds=project.proposals.filter(p=>currentVersion(p).status==='accepted').map(p=>currentVersion(p).id)
  const versionIds=new Set(project.proposals.flatMap(p=>p.versions.map(v=>v.id)))
  if (!summary || summary.revision!==project.revision || acceptedIds.length!==5 || summary.accepted_version_ids.length!==5
    || !acceptedIds.every(id=>summary.accepted_version_ids.includes(id))
    || [...summary.rejected_version_ids,...summary.historical_rejections.map(e=>e.version_id)].some(id=>!versionIds.has(id))) return undefined
  return {revision:summary.revision,text:summary.summary,acceptedVersionIds:summary.accepted_version_ids,rejectedVersionIds:summary.rejected_version_ids}
}
export function toProject(session: RemoteSession, meta?: ProjectMeta): Project {
  const jobs = session.jobs.filter(j => j.kind === 'regenerate')
  const proposals = [...session.variations].sort((a, b) => a.position - b.position).filter(slot => slot.current_version_id !== null).map(slot => {
    const latestJob = jobs.find(job => job.position === slot.position)
    const current = slot.versions.find(v => v.id === slot.current_version_id)!
    return {
      position: slot.position, style: slot.style_id, label: slot.label, currentVersionId: slot.current_version_id!,
      luxuryVariant: slot.luxury_variant ?? undefined, luxuryChoices: slot.luxury_variants ?? [],
      requestedLuxuryVariant: latestJob && ['queued','running'].includes(latestJob.status) ? latestJob.luxury_variant ?? undefined : undefined,
      versions: slot.versions.map(v => ({ id: v.id, number: v.number, status: (v.decision ?? 'pending') as Decision,
        description: v.description, createdAt: v.created_at, imageUrl: v.image_url, seed: v.seed,
        label: typeof v.settings.label === 'string' ? v.settings.label : slot.label,
        luxuryVariant: luxuryVariant(v.settings.variant) ? v.settings.variant : undefined })),
      generation: (latestJob && ['queued', 'running'].includes(latestJob.status) ? 'generating'
        : latestJob?.status === 'failed' && (current.decision === 'rejected' || latestJob.luxury_variant) ? 'failed' : 'idle') as 'generating' | 'failed' | 'idle',
    }
  })
  const events = session.variations.flatMap(slot => slot.versions.flatMap(v => v.decisions.map((event, index) => ({
    id: `${v.id}:${index}`, versionId: v.id, position: slot.position, status: event.decision,
    reason: event.reason ?? '', createdAt: event.created_at,
  })))).sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  return {
    id: session.id, client: meta?.client || `Sesión ${new Date(session.created_at).toLocaleDateString('es-PE')}`,
    room: meta?.room || `Dormitorio · ${session.id.slice(0, 8)}`, preferences: session.preferences,
    photo: { kind: 'remote', name: 'dormitorio-original', url: session.original_image_url },
    createdAt: session.created_at, status: session.status, revision: session.revision, proposals, events,
    messages: [{ id: session.id, text: session.preferences || 'Explorar cinco estilos para este dormitorio.', createdAt: session.created_at }], jobs: session.jobs,
    summary: currentSummary(session.summary,{revision:session.revision,proposals}),
  }
}
export const activeJobs = (project: Project) => project.jobs?.filter(j => j.status === 'queued' || j.status === 'running') ?? []
