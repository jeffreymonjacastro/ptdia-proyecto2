import test from 'node:test'
import assert from 'node:assert/strict'
import { unzipSync } from 'fflate'
import { approvedVersions, buildImageZip, imageFilename } from './downloads.ts'
import { createProject, currentVersion, updateProject } from './domain.ts'

function completed() {
  let project = createProject({ client: 'A', room: 'Dormitorio', preferences: '', photo: { kind: 'example', name: 'example.jpg' }, consent: true, bedroomConfirmed: true })
  for (const proposal of project.proposals) project = updateProject(project, { type: 'decide', position: proposal.position, versionId: currentVersion(proposal).id, status: 'accepted', reason: '' })
  return updateProject(project, { type: 'summarize' })
}

test('solo las cinco versiones vigentes con resumen válido forman la selección final, incluso en pausa', () => {
  const project = completed()
  assert.equal(approvedVersions(project).length, 5)
  assert.equal(approvedVersions({ ...project, status: 'paused' }).length, 5)
  assert.equal(approvedVersions({ ...project, revision: project.revision + 1 }).length, 0)
  assert.equal(approvedVersions({ ...project, summary: { ...project.summary!, acceptedVersionIds: ['old', ...project.summary!.acceptedVersionIds.slice(1)] } }).length, 0)
  assert.equal(approvedVersions({ ...project, summary: { ...project.summary!, acceptedVersionIds: Array(5).fill(project.summary!.acceptedVersionIds[0]) } }).length, 0)
  assert.equal(approvedVersions({ ...project, proposals: project.proposals.slice(1) }).length, 0)
  project.proposals[0].generation = 'generating'
  assert.equal(approvedVersions(project).length, 0)
  project.proposals[0].generation = 'idle'
  currentVersion(project.proposals[0]).status = 'pending'
  assert.equal(approvedVersions(project).length, 0)
})

test('la galería sigue el puntero vigente aunque haya versiones posteriores en el historial', () => {
  const project = completed()
  const slot = project.proposals[0]
  slot.currentVersionId = slot.versions[0].id
  slot.versions.push({ ...slot.versions[0], id: 'old-rejected', number: 9, status: 'rejected' })
  assert.equal(approvedVersions(project)[0].version.number, 1)
})

test('los archivos conservan la extensión real y rechazan contenido ajeno a imágenes', () => {
  assert.equal(imageFilename('luxury', 1, 'image/png'), 'luxury-v1.png')
  assert.equal(imageFilename('neo-classic', 2, 'image/jpeg'), 'neo-classic-v2.jpg')
  assert.equal(imageFilename('attic', 3, 'image/webp; charset=binary'), 'attic-v3.webp')
  assert.throws(() => imageFilename('luxury', 1, 'text/html'))
})

test('el ZIP conserva exactamente los cinco nombres y bytes originales', async () => {
  const images = [
    { filename: 'luxury-v1.png', blob: new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }) },
    { filename: 'japanese-v1.jpg', blob: new Blob([new Uint8Array([4, 5])], { type: 'image/jpeg' }) },
    { filename: 'neo-classic-v1.webp', blob: new Blob([new Uint8Array([6])], { type: 'image/webp' }) },
    { filename: 'attic-v2.png', blob: new Blob([new Uint8Array([7, 8])], { type: 'image/png' }) },
    { filename: 'cyberpunk-v2.png', blob: new Blob([new Uint8Array([9])], { type: 'image/png' }) },
  ]
  const blob = await buildImageZip(images)
  assert.equal(blob.type, 'application/zip')
  const files = unzipSync(new Uint8Array(await blob.arrayBuffer()))
  assert.deepEqual(Object.keys(files), ['luxury-v1.png', 'japanese-v1.jpg', 'neo-classic-v1.webp', 'attic-v2.png', 'cyberpunk-v2.png'])
  assert.deepEqual([...files['attic-v2.png']], [7, 8])
  assert.deepEqual([...files['luxury-v1.png']], [1, 2, 3])
})
