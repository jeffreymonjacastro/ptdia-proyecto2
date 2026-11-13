import test, { afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { Window } from 'happy-dom'
import { IDBFactory } from 'fake-indexeddb'
import { createProject, currentVersion, updateProject, type ProjectAction } from './domain.ts'
import { saveWorkspace, type Workspace } from './storage.ts'

const dom = new Window({ url: 'http://localhost:5173' })
Object.defineProperties(globalThis, {
  window: { value: dom, configurable: true }, document: { value: dom.document, configurable: true },
  navigator: { value: dom.navigator, configurable: true }, HTMLElement: { value: dom.HTMLElement, configurable: true },
  MutationObserver: { value: dom.MutationObserver, configurable: true },
  FormData: { value: dom.FormData, configurable: true },
})
globalThis.createImageBitmap = async () => ({ width: 640, height: 480, close() {} }) as ImageBitmap
const { createElement } = await import('react')
const { render, fireEvent, cleanup, waitFor, renderHook, act } = await import('@testing-library/react')
const { ProposalCard } = await import('./ProposalCard.tsx')
const { ProjectForm } = await import('./ProjectForm.tsx')
const { History } = await import('./History.tsx')
const { useWorkspace } = await import('./useWorkspace.ts')
afterEach(() => cleanup())
const example = () => createProject({ client: 'Valeria', room: 'Dormitorio', preferences: '', photo: { kind: 'example', name: 'ejemplo.jpg' }, consent: true, bedroomConfirmed: true })

test('la tarjeta no reutiliza el motivo de aceptación al rechazar la misma versión', () => {
  let p = example()
  const actions: ProjectAction[] = []
  const onAction = (action: ProjectAction) => { actions.push(action); p = updateProject(p, action) }
  const view = render(createElement(ProposalCard, { proposal: p.proposals[0], paused: false, onAction, onPreview() {} }))
  fireEvent.click(view.getByRole('button', { name: 'Añadir motivo opcional' }))
  fireEvent.change(view.getByRole('textbox', { name: 'Motivo para Luxury' }), { target: { value: 'Me encanta la luz' } })
  fireEvent.click(view.getByRole('button', { name: 'Aceptar Luxury' }))
  assert.equal(p.events[0].reason, 'Me encanta la luz')
  view.rerender(createElement(ProposalCard, { proposal: p.proposals[0], paused: false, onAction, onPreview() {} }))
  fireEvent.click(view.getByRole('button', { name: 'Rechazar Luxury' }))
  assert.equal(p.events[1].reason, '')
})

test('se permite escribir un motivo nuevo para rechazar una propuesta aceptada', () => {
  let p = example()
  p = updateProject(p, { type: 'decide', position: 1, versionId: currentVersion(p.proposals[0]).id, status: 'accepted', reason: '' })
  const view = render(createElement(ProposalCard, { proposal: p.proposals[0], paused: false, onAction: action => { p = updateProject(p, action) }, onPreview() {} }))
  fireEvent.click(view.getByRole('button', { name: 'Añadir motivo opcional' }))
  fireEvent.change(view.getByRole('textbox', { name: 'Motivo para Luxury' }), { target: { value: 'Ahora prefiero más luz natural' } })
  fireEvent.click(view.getByRole('button', { name: 'Rechazar Luxury' }))
  assert.equal(p.events[1].reason, 'Ahora prefiero más luz natural')
})

test('sustituir la foto exige confirmar de nuevo dormitorio y consentimiento', async () => {
  const view = render(createElement(ProjectForm, { onClose() {}, onCreate() {} }))
  const boxes = view.getAllByRole('checkbox') as HTMLInputElement[]
  boxes.forEach(box => fireEvent.click(box))
  assert.ok(boxes.every(box => box.checked))
  const file = new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], 'otra-foto.png', { type: 'image/png' })
  fireEvent.change(view.getByLabelText('Seleccionar fotografía de dormitorio'), { target: { files: [file] } })
  await waitFor(() => assert.ok(view.getByText('otra-foto.png')))
  assert.deepEqual(boxes.map(box => box.checked), [false, false])
})

test('corregir un nombre compuesto por espacios permite volver a crear el proyecto', () => {
  const view = render(createElement(ProjectForm, { onClose() {}, onCreate() {} }))
  fireEvent.change(view.getByRole('textbox', { name: 'Nombre del cliente' }), { target: { value: '   ' } })
  view.getAllByRole('checkbox').forEach(box => fireEvent.click(box))
  fireEvent.submit(view.getByRole('button', { name: 'Crear proyecto' }).closest('form')!)
  assert.ok(view.getByRole('alert'))
  fireEvent.change(view.getByRole('textbox', { name: 'Nombre del cliente' }), { target: { value: 'Valeria' } })
  assert.equal((view.getByRole('button', { name: 'Crear proyecto' }) as HTMLButtonElement).disabled, false)
})

test('el historial conserva el registro aunque su fecha no se pueda interpretar', () => {
  const p = example()
  p.createdAt = 'fecha-inválida'
  const view = render(createElement(History, { project: p, onClose() {} }))
  assert.ok(view.getByText('Fecha desconocida'))
  assert.ok(view.getByText('Proyecto creado'))
})

test('recuperar después de un fallo de lectura preserva las decisiones hechas durante el reintento', async () => {
  const factory = new IDBFactory()
  globalThis.indexedDB = factory
  const saved = example()
  const original: Workspace = { schema: 1, projects: [saved], activeId: saved.id, designer: 'Mariana' }
  await saveWorkspace(original)
  Object.defineProperty(globalThis, 'indexedDB', { value: undefined, writable: true, configurable: true })
  const view = renderHook(() => useWorkspace())
  await waitFor(() => assert.ok(view.result.current.storageError))
  const temporary = example()
  act(() => view.result.current.setWorkspace(previous => previous && { ...previous, projects: [temporary], activeId: temporary.id }))
  globalThis.indexedDB = factory
  await act(async () => {
    const pending = view.result.current.retrySave()
    view.result.current.setWorkspace(previous => previous && { ...previous, projects: previous.projects.map(p => updateProject(p, { type: 'decide', position: 1, versionId: currentVersion(p.proposals[0]).id, status: 'accepted', reason: 'Cambio durante recuperación' })) })
    await pending
  })
  await waitFor(() => assert.equal(view.result.current.saving, false))
  const projects = view.result.current.workspace!.projects
  assert.equal(projects.length, 2)
  const recovered = projects.find(p => p.id === temporary.id)!
  assert.equal(currentVersion(recovered.proposals[0]).status, 'accepted')
  assert.equal(recovered.events[0].reason, 'Cambio durante recuperación')
})

test('una lectura fallida no introduce otros cinco clientes de ejemplo en la recuperación', async () => {
  Object.defineProperty(globalThis, 'indexedDB', { value: undefined, writable: true, configurable: true })
  const view = renderHook(() => useWorkspace())
  await waitFor(() => assert.ok(view.result.current.storageError))
  assert.equal(view.result.current.workspace!.projects.length, 0)
})
