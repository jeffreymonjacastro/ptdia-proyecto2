import test from 'node:test'
import assert from 'node:assert/strict'
import { createProject, updateProject, currentVersion, canSummarize, buildSummary } from './domain.ts'

const input = { client: 'Valeria Mendoza', room: 'Dormitorio principal', preferences: '', photo: { kind: 'example' as const, name: 'dormitorio-ejemplo.jpg' }, consent: true, bedroomConfirmed: true }
const project = () => createProject(input)

test('una sesión comienza con cinco estilos distintos y todas las versiones pendientes', () => {
  const p = project()
  assert.deepEqual(p.proposals.map(v => v.style), ['luxury', 'japanese', 'neo-classic', 'attic', 'cyberpunk'])
  assert.deepEqual(p.proposals.map(v => currentVersion(v).status), ['pending', 'pending', 'pending', 'pending', 'pending'])
  assert.equal(p.events.length, 0)
})

test('carga sin consentimiento o sin confirmación de dormitorio no crea una sesión', () => {
  assert.throws(() => createProject({ ...input, consent: false }), /autorización/)
  assert.throws(() => createProject({ ...input, bedroomConfirmed: false }), /dormitorio/)
  assert.throws(() => createProject({ ...input, client: '  ' }), /cliente/)
})

test('rechazar conserva las otras cuatro y registra el motivo sobre la versión exacta', () => {
  let p = project()
  p = updateProject(p, { type: 'decide', position: 1, versionId: currentVersion(p.proposals[0]).id, status: 'accepted', reason: '' })
  const before = structuredClone(p.proposals)
  const versionId = currentVersion(p.proposals[3]).id
  p = updateProject(p, { type: 'decide', position: 4, versionId, status: 'rejected', reason: 'Conservar el techo' })
  assert.deepEqual(p.proposals.filter(v => v.position !== 4), before.filter(v => v.position !== 4))
  assert.equal(currentVersion(p.proposals[3]).status, 'rejected')
  assert.equal(p.proposals[3].generation, 'generating')
  assert.deepEqual(p.events.map(e => [e.position, e.versionId, e.status, e.reason]), [[1, currentVersion(before[0]).id, 'accepted', ''], [4, versionId, 'rejected', 'Conservar el techo']])
})

test('regenerar añade una versión pendiente y conserva la rechazada y su motivo', () => {
  let p = project()
  const v1 = currentVersion(p.proposals[3]).id
  p = updateProject(p, { type: 'decide', position: 4, versionId: v1, status: 'rejected', reason: 'Techo original' })
  p = updateProject(p, { type: 'regenerated', position: 4, versionId: v1 })
  const proposal = p.proposals[3]
  assert.deepEqual(proposal.versions.map(v => [v.number, v.status]), [[1, 'rejected'], [2, 'pending']])
  assert.notEqual(currentVersion(proposal).id, v1)
  assert.equal(p.events[0].reason, 'Techo original')
  assert.equal(canSummarize(p), false)
})

test('un rechazo duplicado y una respuesta obsoleta no duplican eventos o versiones', () => {
  let p = project()
  const id = currentVersion(p.proposals[0]).id
  const action = { type: 'decide' as const, position: 1, versionId: id, status: 'rejected' as const, reason: '' }
  p = updateProject(updateProject(p, action), action)
  assert.equal(p.events.length, 1)
  p = updateProject(p, { type: 'regenerated', position: 1, versionId: id })
  p = updateProject(p, { type: 'regenerated', position: 1, versionId: id })
  p = updateProject(p, { ...action, status: 'accepted' })
  assert.equal(p.proposals[0].versions.length, 2)
  assert.equal(currentVersion(p.proposals[0]).status, 'pending')
})

test('fallar y reintentar conserva el rechazo sin duplicarlo', () => {
  let p = project()
  const id = currentVersion(p.proposals[0]).id
  p = updateProject(p, { type: 'decide', position: 1, versionId: id, status: 'rejected', reason: '' })
  p = updateProject(p, { type: 'generation-failed', position: 1, versionId: id })
  assert.equal(p.proposals[0].generation, 'failed')
  p = updateProject(p, { type: 'retry', position: 1, versionId: id })
  assert.equal(p.proposals[0].generation, 'generating')
  assert.equal(p.events.length, 1)
  assert.equal(p.proposals[0].versions.length, 1)
})

test('pausar conserva decisiones e impide cambios hasta reanudar', () => {
  let p = updateProject(project(), { type: 'pause' })
  const before = structuredClone(p)
  p = updateProject(p, { type: 'decide', position: 1, versionId: currentVersion(p.proposals[0]).id, status: 'accepted', reason: '' })
  assert.deepEqual(p, before)
  p = updateProject(p, { type: 'resume' })
  p = updateProject(p, { type: 'decide', position: 1, versionId: currentVersion(p.proposals[0]).id, status: 'accepted', reason: '' })
  assert.equal(currentVersion(p.proposals[0]).status, 'accepted')
})

test('de las 32 combinaciones solo cinco aceptaciones habilitan el resumen final', () => {
  for (let mask = 0; mask < 32; mask++) {
    let p = project()
    for (const proposal of p.proposals) {
      p = updateProject(p, { type: 'decide', position: proposal.position, versionId: currentVersion(proposal).id, status: mask & (1 << (proposal.position - 1)) ? 'accepted' : 'rejected', reason: '' })
    }
    assert.equal(canSummarize(p), mask === 31)
    if (mask !== 31) assert.throws(() => buildSummary(p), /cinco/)
  }
})

test('el resumen identifica aceptadas actuales, rechazos históricos y solo motivos registrados', () => {
  let p = project()
  const oldId = currentVersion(p.proposals[3]).id
  p = updateProject(p, { type: 'decide', position: 4, versionId: oldId, status: 'rejected', reason: 'Mantener el techo original' })
  p = updateProject(p, { type: 'regenerated', position: 4, versionId: oldId })
  for (const proposal of p.proposals) p = updateProject(p, { type: 'decide', position: proposal.position, versionId: currentVersion(proposal).id, status: 'accepted', reason: '' })
  const summary = buildSummary(p)
  assert.equal(summary.acceptedVersionIds.length, 5)
  assert.deepEqual(summary.rejectedVersionIds, [oldId])
  assert.ok(summary.text.includes('Mantener el techo original'))
  assert.ok(summary.text.includes('Attic · V2'))
  assert.ok(summary.text.includes('Sin motivo indicado'))
  assert.ok(summary.text.includes('demostración'))
})

test('cambiar una decisión invalida el resumen anterior', () => {
  let p = project()
  for (const proposal of p.proposals) p = updateProject(p, { type: 'decide', position: proposal.position, versionId: currentVersion(proposal).id, status: 'accepted', reason: '' })
  p = updateProject(p, { type: 'summarize' })
  assert.ok(p.summary)
  p = updateProject(p, { type: 'decide', position: 1, versionId: currentVersion(p.proposals[0]).id, status: 'rejected', reason: '' })
  assert.equal(p.summary, undefined)
})

test('proyectos y cargas nuevas no heredan decisiones ni resumen', () => {
  let first = project()
  first = updateProject(first, { type: 'decide', position: 1, versionId: currentVersion(first.proposals[0]).id, status: 'accepted', reason: '' })
  const second = createProject({ ...input, client: 'Otro cliente' })
  assert.notEqual(first.id, second.id)
  assert.equal(second.events.length, 0)
  assert.equal(second.summary, undefined)
  assert.equal(currentVersion(second.proposals[0]).status, 'pending')
})

test('una preferencia nueva conserva el mensaje inicial y las propuestas ya aceptadas', () => {
  let p = createProject({ ...input, preferences: 'Conservar la cama' })
  p = updateProject(p, { type: 'decide', position: 1, versionId: currentVersion(p.proposals[0]).id, status: 'accepted', reason: '' })
  const before = structuredClone(p.proposals)
  p = updateProject(p, { type: 'feedback', text: 'Prefiero madera clara' })
  assert.deepEqual(p.messages.map(m => m.text), ['Conservar la cama', 'Prefiero madera clara'])
  assert.equal(p.preferences, 'Prefiero madera clara')
  assert.deepEqual(p.proposals, before)
})
