import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parseSession, toProject } from './remote.ts'

const fixture = () => JSON.parse(readFileSync(new URL('./fixtures/session.json', import.meta.url), 'utf8'))
test('el JSON del backend conserva IDs, null como pendiente, imagen privada y seed string', () => {
  const session = parseSession(fixture())
  const project = toProject(session, { client: 'Valeria', room: 'Dormitorio principal' })
  assert.equal(project.id, '00000000-0000-0000-0000-000000000010')
  assert.equal(project.proposals.length, 5)
  assert.equal(project.proposals[0].versions[0].status, 'pending')
  assert.equal(project.proposals[0].versions[0].seed, '9223372036854775806')
  assert.equal(project.proposals[0].versions[0].imageUrl, '/api/generations/00000000-0000-0000-0000-000000000010/versions/00000000-0000-0000-0000-000000000021/image')
})
test('la versión vigente se encuentra por current_version_id y no por el último elemento', () => {
  const raw = fixture()
  const current = raw.variations[0].versions[0]
  raw.variations[0].versions.push({ ...current, id: 'otra-version', number: 2, decision: 'rejected' })
  const project = toProject(parseSession(raw))
  assert.equal(project.proposals[0].currentVersionId, current.id)
})
test('un lote ready parcial o con un puntero roto no se presenta como cinco propuestas', () => {
  const raw = fixture()
  raw.variations.pop()
  assert.throws(() => parseSession(raw), /respuesta|propuestas|lote/i)
  const broken = fixture()
  broken.variations[0].current_version_id = 'inexistente'
  assert.throws(() => parseSession(broken), /respuesta|versión|lote/i)
})
test('un trabajo inicial sin imágenes conserva su estado sin fabricar versiones', () => {
  const raw = fixture()
  raw.status = 'needs_confirmation'
  raw.variations.forEach((v: any) => { v.current_version_id = null; v.versions = [] })
  const project = toProject(parseSession(raw))
  assert.equal(project.status, 'needs_confirmation')
  assert.equal(project.proposals.length, 0)
})
test('el resumen remoto usa summary.summary y solo se muestra si su revisión sigue vigente', () => {
  const raw = fixture()
  raw.variations.forEach((v: any) => { v.versions[0].decision = 'accepted' })
  raw.summary = { revision: 1, accepted_version_ids: raw.variations.map((v: any) => v.current_version_id), rejected_version_ids: [], historical_rejections: [], summary: 'Resumen real español.' }
  assert.equal(toProject(parseSession(raw)).summary!.text, 'Resumen real español.')
  raw.summary.revision = 0
  assert.equal(toProject(parseSession(raw)).summary, undefined)
})
test('el historial incorpora decisiones de versiones antiguas sin inventar motivos', () => {
  const raw = fixture()
  const first = raw.variations[0].versions[0]
  first.decisions = [{ version_id: first.id, decision: 'rejected', reason: 'Techo original', created_at: '2026-11-17T12:01:00Z' }]
  first.decision = 'rejected'
  const next = { ...first, id: 'nueva', number: 2, decision: null, decisions: [] }
  raw.variations[0].versions.push(next)
  raw.variations[0].current_version_id = 'nueva'
  const p = toProject(parseSession(raw))
  assert.equal(p.events[0].reason, 'Techo original')
  assert.equal(p.events[0].versionId, first.id)
  assert.equal(p.proposals[0].versions[1].status, 'pending')
})

test('una propuesta sin ruta de imagen no se sustituye por una imagen de demo', () => {
  const raw=fixture()
  raw.variations[0].versions[0].image_url=''
  assert.throws(()=>parseSession(raw),/respuesta|lote/i)
})
