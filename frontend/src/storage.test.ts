import test, { beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { IDBFactory } from 'fake-indexeddb'
import { createProject, currentVersion, updateProject } from './domain.ts'
import { loadWorkspace, saveWorkspace, type Workspace } from './storage.ts'

beforeEach(() => { globalThis.indexedDB = new IDBFactory() })
const workspace = (): Workspace => {
  const p = createProject({ client: 'Valeria', room: 'Dormitorio', preferences: '', photo: { kind: 'upload', name: 'foto.png', blob: new Blob(['foto'], { type: 'image/png' }), width: 640, height: 480 }, consent: true, bedroomConfirmed: true })
  return { schema: 1, projects: [p], activeId: p.id, designer: 'Mariana' }
}

test('IndexedDB conserva la foto, decisiones y proyecto seleccionado al volver a cargar', async () => {
  assert.equal(await loadWorkspace(), undefined)
  const data = workspace()
  data.projects[0] = updateProject(data.projects[0], { type: 'decide', position: 1, versionId: currentVersion(data.projects[0].proposals[0]).id, status: 'accepted', reason: 'Conservar la luz cálida' })
  await saveWorkspace(data)
  const loaded = (await loadWorkspace())!
  assert.equal(loaded.activeId, data.activeId)
  assert.equal(loaded.projects[0].photo.kind, 'upload')
  const photo = loaded.projects[0].photo
  assert.equal(photo.kind === 'upload' && await photo.blob.text(), 'foto')
  assert.equal(loaded.projects[0].proposals.length, 5)
  assert.equal(currentVersion(loaded.projects[0].proposals[0]).status, 'accepted')
  assert.equal(loaded.projects[0].events[0].reason, 'Conservar la luz cálida')
})

test('eliminar todas las sesiones se conserva y no repuebla ejemplos al recargar', async () => {
  await saveWorkspace({ schema: 1, projects: [], activeId: null, designer: 'Mariana' })
  const loaded = (await loadWorkspace())!
  assert.deepEqual(loaded.projects, [])
  assert.equal(loaded.activeId, null)
})

test('datos incompatibles se notifican sin sobrescribir el historial existente', async () => {
  const original = workspace()
  await saveWorkspace(original)
  await assert.rejects(saveWorkspace({ ...original, schema: 2 } as unknown as Workspace), /incompatible/)
  assert.equal((await loadWorkspace())!.activeId, original.activeId)
})
