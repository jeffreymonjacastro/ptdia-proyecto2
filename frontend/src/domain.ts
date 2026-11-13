export type Style = 'luxury' | 'japanese' | 'neo-classic' | 'attic' | 'cyberpunk'
export type Decision = 'pending' | 'accepted' | 'rejected'
export type Photo = { kind: 'example'; name: string } | { kind: 'upload'; name: string; blob: Blob; width: number; height: number }
export type Version = { id: string; number: number; status: Decision; description: string; createdAt: string }
export type Proposal = { position: number; style: Style; versions: Version[]; generation: 'idle' | 'generating' | 'failed' }
export type DecisionEvent = { id: string; position: number; versionId: string; status: Exclude<Decision, 'pending'>; reason: string; createdAt: string }
export type Summary = { revision: number; acceptedVersionIds: string[]; rejectedVersionIds: string[]; text: string }
export type Project = {
  id: string; client: string; room: string; preferences: string; photo: Photo; createdAt: string
  status: 'ready' | 'paused' | 'completed'; revision: number; proposals: Proposal[]
  events: DecisionEvent[]; messages: { id: string; text: string; createdAt: string }[]; summary?: Summary
}
export type ProjectInput = Pick<Project, 'client' | 'room' | 'preferences' | 'photo'> & { consent: boolean; bedroomConfirmed: boolean }
export type ProjectAction =
  | { type: 'decide'; position: number; versionId: string; status: 'accepted' | 'rejected'; reason: string }
  | { type: 'regenerated' | 'generation-failed' | 'retry'; position: number; versionId: string }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'summarize' }
  | { type: 'feedback'; text: string }

export const STYLES: Record<Style, { name: string; description: string; crop: string; accent: string }> = {
  luxury: { name: 'Luxury', description: 'Mármol, nogal y luz cálida.', crop: '287 191 375 211', accent: '#c3a480' },
  japanese: { name: 'Japanese', description: 'Madera clara y líneas serenas.', crop: '682 191 374 211', accent: '#aebc97' },
  'neo-classic': { name: 'Neo Classic', description: 'Molduras y equilibrio visual.', crop: '1074 191 375 211', accent: '#c7bead' },
  attic: { name: 'Attic', description: 'Techo inclinado y vigas vistas.', crop: '287 520 375 188', accent: '#c8a57a' },
  cyberpunk: { name: 'Cyberpunk', description: 'Contrastes oscuros y luz neón.', crop: '682 520 374 188', accent: '#b69dca' },
}
export const STYLE_IDS = Object.keys(STYLES) as Style[]
export const currentVersion = (proposal: Proposal): Version => proposal.versions[proposal.versions.length - 1]
const now = () => new Date().toISOString()

export function createProject(input: ProjectInput): Project {
  if (!input.client.trim()) throw new Error('Escribe el nombre del cliente.')
  if (!input.bedroomConfirmed) throw new Error('Confirma que la fotografía muestra un dormitorio.')
  if (!input.consent) throw new Error('Necesitamos tu autorización para guardar la foto en este navegador.')
  const id = crypto.randomUUID()
  return {
    id, client: input.client.trim(), room: input.room.trim() || 'Dormitorio principal',
    preferences: input.preferences.trim(), photo: input.photo, createdAt: now(), status: 'ready', revision: 0,
    proposals: STYLE_IDS.map((style, index) => ({ position: index + 1, style, generation: 'idle', versions: [{
      id: `${id}:${style}:v1`, number: 1, status: 'pending', description: STYLES[style].description, createdAt: now(),
    }] })), events: [], messages: [{ id: crypto.randomUUID(), text: input.preferences.trim() || 'Queremos explorar cinco estilos para este dormitorio.', createdAt: now() }],
  }
}

export function canSummarize(project: Project): boolean {
  return project.status !== 'paused' && project.proposals.length === 5 && project.proposals.every(p => p.generation === 'idle' && currentVersion(p).status === 'accepted')
}

export function buildSummary(project: Project): Summary {
  if (!canSummarize(project)) throw new Error('Acepta las cinco propuestas actuales antes de solicitar el resumen final.')
  const latest = new Map(project.events.map(event => [event.versionId, event]))
  const rejected = [...latest.values()].filter(event => event.status === 'rejected')
  const label = (position: number, versionId: string) => {
    const proposal = project.proposals.find(p => p.position === position)!
    const version = proposal.versions.find(v => v.id === versionId)!
    return `${STYLES[proposal.style].name} · V${version.number} [${version.id}]`
  }
  return {
    revision: project.revision,
    acceptedVersionIds: project.proposals.map(p => currentVersion(p).id),
    rejectedVersionIds: rejected.map(e => e.versionId),
    text: [
      'Resumen de demostración elaborado a partir de las decisiones registradas. No interviene un modelo de IA.',
      '\nPROPUESTAS ACEPTADAS',
      ...project.proposals.map(p => {
        const v = currentVersion(p)
        return `• ${label(p.position, v.id)}. ${latest.get(v.id)?.reason || 'Sin motivo indicado.'}`
      }),
      '\nRECHAZOS ANTERIORES',
      ...(rejected.length ? rejected.map(e => `• ${label(e.position, e.versionId)}. ${e.reason || 'Sin motivo indicado.'}`) : ['No se registraron rechazos.']),
    ].join('\n'),
  }
}

export function updateProject(project: Project, action: ProjectAction): Project {
  if (action.type === 'resume') return project.status === 'paused' ? { ...project, status: project.summary ? 'completed' : 'ready' } : project
  if (project.status === 'paused') return project
  if (action.type === 'pause') return { ...project, status: 'paused' }
  if (action.type === 'summarize') return canSummarize(project) ? { ...project, status: 'completed', summary: buildSummary(project) } : project
  if (action.type === 'feedback') {
    const text = action.text.trim()
    return text ? { ...project, preferences: text, messages: [...project.messages, { id: crypto.randomUUID(), text, createdAt: now() }] } : project
  }
  const proposal = project.proposals.find(p => p.position === action.position)
  if (!proposal || currentVersion(proposal).id !== action.versionId) return project
  const version = currentVersion(proposal)
  let changed: Proposal
  let events = project.events
  if (action.type === 'decide') {
    if (proposal.generation !== 'idle' || version.status === action.status) return project
    changed = { ...proposal, generation: action.status === 'rejected' ? 'generating' : 'idle', versions: proposal.versions.map(v => v.id === version.id ? { ...v, status: action.status } : v) }
    events = [...events, { id: crypto.randomUUID(), position: proposal.position, versionId: version.id, status: action.status, reason: action.reason.trim(), createdAt: now() }]
  } else {
    if (version.status !== 'rejected') return project
    if (action.type === 'retry') {
      if (proposal.generation !== 'failed') return project
      changed = { ...proposal, generation: 'generating' }
    } else {
      if (proposal.generation !== 'generating') return project
      changed = action.type === 'generation-failed' ? { ...proposal, generation: 'failed' } : {
        ...proposal, generation: 'idle', versions: [...proposal.versions, {
          id: `${project.id}:${proposal.style}:v${version.number + 1}`, number: version.number + 1,
          status: 'pending', description: STYLES[proposal.style].description, createdAt: now(),
        }],
      }
    }
  }
  return { ...project, proposals: project.proposals.map(p => p.position === changed.position ? changed : p), events, revision: project.revision + 1, summary: undefined, status: 'ready' }
}

export function seedProjects(): Project[] {
  return [
    ['Valeria Mendoza', 'Dormitorio principal', 'Queremos renovar el dormitorio, mantener la distribución y explorar cinco estilos.'],
    ['Carlos y Lucía', 'Dormitorio matrimonial', 'Preferimos colores cálidos, madera y mucha luz natural.'],
    ['Andrea Torres', 'Dormitorio juvenil', 'Un espacio tranquilo para descansar y leer.'],
    ['Familia Ramírez', 'Dormitorio de visitas', 'Buscamos un dormitorio acogedor y fácil de mantener.'],
    ['Diego Salazar', 'Dormitorio principal', 'Queremos explorar acabados oscuros y luz indirecta.'],
  ].map(([client, room, preferences]) => createProject({ client, room, preferences, photo: { kind: 'example', name: 'dormitorio-ejemplo.jpg' }, consent: true, bedroomConfirmed: true }))
}
