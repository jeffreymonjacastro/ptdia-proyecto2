import { STYLE_IDS, type Project } from './domain.ts'
export type Workspace = { schema: 1; projects: Project[]; activeId: string | null; designer: string }

function validate(value: unknown): asserts value is Workspace {
  try {
    const data = value as Workspace
    const valid = data.schema === 1 && typeof data.designer === 'string' && Array.isArray(data.projects)
      && (data.activeId === null || data.projects.some(p => p.id === data.activeId))
      && data.projects.every(p => typeof p.id === 'string' && typeof p.client === 'string' && typeof p.room === 'string'
        && typeof p.preferences === 'string' && typeof p.createdAt === 'string' && Number.isSafeInteger(p.revision)
        && ['ready', 'paused', 'completed'].includes(p.status)
        && typeof p.photo.name === 'string' && (p.photo.kind === 'example' || (p.photo.kind === 'upload' && p.photo.blob instanceof Blob))
        && p.proposals.length === 5 && p.proposals.every((v, i) => v.position === i + 1 && v.style === STYLE_IDS[i]
          && ['idle', 'generating', 'failed'].includes(v.generation) && v.versions.length > 0
          && v.versions.every((version, index) => version.number === index + 1 && typeof version.id === 'string'
            && typeof version.description === 'string' && ['pending', 'accepted', 'rejected'].includes(version.status)))
        && Array.isArray(p.events) && p.events.every(e => typeof e.reason === 'string' && typeof e.createdAt === 'string'
          && ['accepted', 'rejected'].includes(e.status) && p.proposals.some(v => v.position === e.position && v.versions.some(version => version.id === e.versionId)))
        && Array.isArray(p.messages) && p.messages.every(m => typeof m.text === 'string' && typeof m.id === 'string')
        && (!p.summary || (typeof p.summary.text === 'string' && p.summary.revision === p.revision)))
    if (valid) return
  } catch { /* Los registros incompatibles se conservan para no perder datos. */ }
  throw new Error('El historial local es incompatible o está dañado. No se ha sobrescrito.')
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('ptdia-bedroom-demo', 1)
    let blocked = false
    request.onupgradeneeded = () => request.result.createObjectStore('workspace')
    request.onerror = () => reject(request.error)
    request.onblocked = () => { blocked = true; reject(new Error('Cierra las otras pestañas de la demo para abrir el historial.')) }
    request.onsuccess = () => {
      if (blocked) request.result.close()
      else resolve(request.result)
    }
  })
}

export async function loadWorkspace(): Promise<Workspace | undefined> {
  const db = await openDatabase()
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('workspace', 'readonly')
    const request = transaction.objectStore('workspace').get('current')
    transaction.oncomplete = () => {
      db.close()
      try {
        if (request.result === undefined) return resolve(undefined)
        validate(request.result)
        resolve(request.result)
      } catch (error) { reject(error) }
    }
    transaction.onabort = () => { db.close(); reject(transaction.error) }
  })
}

// Una cola mantiene el orden incluso si una foto tarda más en escribirse.
let writes: Promise<void> = Promise.resolve()
export async function saveWorkspace(workspace: Workspace): Promise<void> {
  validate(workspace)
  writes = writes.catch(() => {}).then(async () => {
    const db = await openDatabase()
    return new Promise<void>((resolve, reject) => {
      const transaction = db.transaction('workspace', 'readwrite')
      transaction.objectStore('workspace').put(workspace, 'current')
      transaction.oncomplete = () => { db.close(); resolve() }
      transaction.onabort = () => { db.close(); reject(transaction.error ?? new Error('No se pudo guardar el historial.')) }
    })
  })
  return writes
}
