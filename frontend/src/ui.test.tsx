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

test('solo Luxury ofrece los dos modelos y el cambio solicita una nueva versión sin rechazar', () => {
  const proposal = example().proposals[0]
  proposal.luxuryVariant = 'custom'
  proposal.luxuryChoices = [{id:'custom',label:'Luxury UTEC'},{id:'pretrained',label:'Luxury original'}]
  const actions: ProjectAction[] = []
  const view = render(createElement(ProposalCard, {proposal, connected:true, paused:false, onAction: action => { actions.push(action) }, onPreview() {}}))
  const choice = view.getByRole('combobox', {name:'Modelo de Luxury'})
  assert.equal((choice as HTMLSelectElement).value, 'custom')
  fireEvent.change(choice, {target:{value:'pretrained'}})
  assert.deepEqual(actions, [{type:'switch-luxury',position:1,versionId:proposal.versions[0].id,variant:'pretrained'}])
  view.rerender(createElement(ProposalCard, {proposal, connected:true, paused:true, onAction() {}, onPreview() {}}))
  assert.equal((view.getByRole('combobox', {name:'Modelo de Luxury'}) as HTMLSelectElement).disabled, true)
})

test('la descripción muestra negritas y listas Markdown', () => {
  const project = example()
  currentVersion(project.proposals[0]).description = 'Cambios visibles:\n\n* **Iluminación:** Luz cálida.\n* **Colores:** Tonos beige.'
  const view = render(createElement(ProposalCard, { proposal: project.proposals[0], paused: false, onAction() {}, onPreview() {} }))
  assert.equal(view.getAllByRole('listitem').length, 2)
  assert.equal(view.container.querySelector('strong')?.textContent, 'Iluminación:')
  assert.ok(!view.container.querySelector('.proposal-description')!.textContent!.includes('**'))
})

test('la descripción admite texto simple e ignora HTML e imágenes externas', () => {
  const project = example()
  currentVersion(project.proposals[0]).description = 'Se conserva la ventana.\n\n<script>alert(1)</script>\n\n<img src="https://example.com/tracker" onerror="alert(1)">\n\n![externa](https://example.com/image.png)'
  const view = render(createElement(ProposalCard, { proposal: project.proposals[0], paused: false, onAction() {}, onPreview() {} }))
  const description = view.container.querySelector('.proposal-description')!
  assert.ok(view.getByText('Se conserva la ventana.'))
  assert.equal(description.querySelector('script, img'), null)
  assert.ok(!description.textContent!.includes('<script>'))
})

test('rechazar solicita un motivo antes de cambiar la versión y permite cancelar', () => {
  let p = example()
  const original = structuredClone(p)
  const view = render(createElement(ProposalCard, { proposal: p.proposals[0], paused: false, onAction: action => { p = updateProject(p, action) }, onPreview() {} }))
  fireEvent.click(view.getByRole('button', { name: 'Rechazar Luxury' }))
  assert.ok(view.getByRole('dialog'))
  assert.deepEqual(p, original)
  fireEvent.click(view.getByRole('button', { name: 'Cancelar' }))
  assert.equal(view.queryByRole('dialog'), null)
  assert.deepEqual(p, original)
})

test('el rechazo exige un motivo no vacío y conserva el texto al confirmar', () => {
  let p = example()
  const view = render(createElement(ProposalCard, { proposal: p.proposals[0], paused: false, onAction: action => { p = updateProject(p, action) }, onPreview() {} }))
  fireEvent.click(view.getByRole('button', { name: 'Rechazar Luxury' }))
  const field = view.getByRole('textbox', { name: 'Motivo del rechazo' })
  const confirm = view.getByRole('button', { name: 'Rechazar y regenerar' }) as HTMLButtonElement
  assert.equal(confirm.disabled, true)
  fireEvent.change(field, { target: { value: '   ' } })
  fireEvent.submit(confirm.closest('form')!)
  assert.equal(p.events.length, 0)
  fireEvent.change(field, { target: { value: '  Queremos conservar la ventana.  ' } })
  assert.equal(confirm.disabled, false)
  fireEvent.submit(confirm.closest('form')!)
  assert.equal(p.events[0].reason, 'Queremos conservar la ventana.')
  assert.equal(p.proposals[0].generation, 'generating')
  assert.equal(view.queryByRole('dialog'), null)
})

test('el motivo de una aceptación no se reutiliza al pedir el motivo del rechazo', () => {
  let p = example()
  const onAction = (action: ProjectAction) => { p = updateProject(p, action) }
  const view = render(createElement(ProposalCard, { proposal: p.proposals[0], paused: false, onAction, onPreview() {} }))
  fireEvent.click(view.getByRole('button', { name: 'Añadir motivo opcional' }))
  fireEvent.change(view.getByRole('textbox', { name: 'Motivo para Luxury' }), { target: { value: 'Me encanta la luz' } })
  fireEvent.click(view.getByRole('button', { name: 'Aceptar Luxury' }))
  view.rerender(createElement(ProposalCard, { proposal: p.proposals[0], paused: false, onAction, onPreview() {} }))
  fireEvent.click(view.getByRole('button', { name: 'Rechazar Luxury' }))
  const field = view.getByRole('textbox', { name: 'Motivo del rechazo' }) as HTMLTextAreaElement
  assert.equal(field.value, '')
  assert.equal(p.events.length, 1)
  fireEvent.change(field, { target: { value: 'Ahora prefiero más luz natural' } })
  fireEvent.submit(view.getByRole('button', { name: 'Rechazar y regenerar' }).closest('form')!)
  assert.equal(p.events[0].reason, 'Me encanta la luz')
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

test('una tarjeta conectada nunca fabrica una versión mediante el temporizador de demo', async () => {
  const p = example()
  p.proposals[0].versions[0].status = 'rejected'
  p.proposals[0].generation = 'generating'
  const actions: ProjectAction[] = []
  render(createElement(ProposalCard, {proposal:p.proposals[0],paused:false,connected:true,onAction:action=>{actions.push(action)},onPreview(){}}))
  await new Promise(resolve=>setTimeout(resolve,1750))
  assert.equal(actions.length,0)
})

test('el formulario conectado envía la foto y el consentimiento actuales sin crear un proyecto simulado', async () => {
  let sent: import('./domain.ts').ProjectInput | undefined
  let simulated = false
  const view = render(createElement(ProjectForm,{onClose(){},onCreate(){simulated=true},onSubmitRemote:async input=>{sent=input}}))
  fireEvent.change(view.getByRole('textbox',{name:'Nombre del cliente'}),{target:{value:'Cliente real'}})
  const file=new File([new Uint8Array([137,80,78,71,13,10,26,10])],'propia.png',{type:'image/png'})
  fireEvent.change(view.getByLabelText('Seleccionar fotografía de dormitorio'),{target:{files:[file]}})
  await waitFor(()=>assert.ok(view.getByText('propia.png')))
  view.getAllByRole('checkbox').forEach(box=>fireEvent.click(box))
  fireEvent.submit(view.getByRole('button',{name:'Crear proyecto'}).closest('form')!)
  await waitFor(()=>assert.ok(sent))
  assert.equal(sent!.photo.kind,'upload')
  assert.equal(sent!.consent,true)
  assert.equal(sent!.bedroomConfirmed,true)
  assert.equal(simulated,false)
})

test('una miniatura privada fallida mantiene un único botón para abrirla', async () => {
  const {ImageContext}=await import('./PrivateImage.tsx')
  const p=example()
  p.proposals[0].versions[0].imageUrl='/api/generations/s/versions/v/image'
  const view=render(createElement(ImageContext.Provider,{value:async()=>{throw new Error('Sin conexión')}},createElement(ProposalCard,{proposal:p.proposals[0],paused:false,connected:true,onAction(){},onPreview(){}})))
  await waitFor(()=>assert.ok(view.getByText('Sin conexión')))
  const preview=view.getByRole('button',{name:'Ampliar Luxury, versión 1'})
  assert.equal(preview.querySelectorAll('button').length,0)
})

test('un borrador de rechazo cancelado no se registra como motivo de aceptación',()=>{
  const actions:ProjectAction[]=[]
  const view=render(createElement(ProposalCard,{proposal:example().proposals[0],paused:false,onPreview(){},onAction:action=>{actions.push(action)}}))
  fireEvent.click(view.getByRole('button',{name:'Añadir motivo opcional'}))
  fireEvent.change(view.getByRole('textbox',{name:'Motivo para Luxury'}),{target:{value:'Aceptación opcional'}})
  fireEvent.click(view.getByRole('button',{name:'Rechazar Luxury'}))
  assert.equal((view.getByRole('textbox',{name:'Motivo del rechazo'}) as HTMLTextAreaElement).value,'')
  fireEvent.change(view.getByRole('textbox',{name:'Motivo del rechazo'}),{target:{value:'Cambiar techo'}})
  fireEvent.click(view.getByRole('button',{name:'Cancelar'}))
  fireEvent.click(view.getByRole('button',{name:'Aceptar Luxury'}))
  assert.equal((actions[0] as Extract<ProjectAction,{type:'decide'}>).reason,'Aceptación opcional')
})
const {default:App}=await import('./App.tsx')
const remoteView=(p:import('./domain.ts').Project):import('./useRemoteWorkspace.ts').RemoteController=>({connected:true,workspace:{schema:1,projects:[p],activeId:p.id,designer:'a@example.test'},setWorkspace(){},saving:false,storageError:'',retrySave:async()=>{},onAction:async()=>{},create:async()=>{},remove:async()=>{},initial:async()=>{},refresh:async()=>{},signOut:async()=>{}})
for(const status of ['rejected','failed','needs_confirmation','generating'] as const)test(`se puede solicitar borrar una fotografía en estado ${status}`,()=>{
  const p=example();p.status=status;p.proposals=[]
  const view=render(createElement(App,{remote:remoteView(p)}))
  fireEvent.click(view.getByRole('button',{name:/^Eliminar proyecto$/}))
  assert.ok(view.getByRole('dialog',{name:'¿Eliminar este proyecto?'}))
})
test('un resumen fallido muestra el error y permite reintentar explícitamente',()=>{
  const p=example();p.proposals.forEach(slot=>slot.versions[0].status='accepted')
  p.jobs=[{id:'summary-job',kind:'summary',status:'failed',position:null,progress:0,error:'inference_failed'}]
  const view=render(createElement(App,{remote:remoteView(p)}))
  assert.match(view.getByRole('alert').textContent!,/resumen/i)
  assert.ok(view.getByRole('button',{name:'Reintentar resumen'}))
})

function completedProject() {
  let project = example()
  for (const proposal of project.proposals) project = updateProject(project, { type: 'decide', position: proposal.position, versionId: currentVersion(proposal).id, status: 'accepted', reason: '' })
  project.proposals.forEach(proposal => { currentVersion(proposal).imageUrl = `/api/generations/${project.id}/versions/${currentVersion(proposal).id}/image` })
  return updateProject(project, { type: 'summarize' })
}

test('Luxury deshabilita el selector cuando otro estilo tiene un job activo', () => {
  const p = completedProject()
  p.proposals[0].luxuryVariant = 'custom'
  p.proposals[0].luxuryChoices = [{id:'custom',label:'Luxury UTEC'},{id:'pretrained',label:'Luxury original'}]
  p.jobs = [{id:'attic-job',kind:'regenerate',position:4,status:'queued',progress:0,error:null}]
  const view = render(createElement(App, {remote:remoteView(p)}))
  assert.equal((view.getByRole('combobox', {name:'Modelo de Luxury'}) as HTMLSelectElement).disabled, true)
})

test('el historial permite ver versiones sustituidas sin registrar decisiones', async () => {
  const {ImageContext} = await import('./PrivateImage.tsx')
  const p = completedProject()
  p.events = []
  const slot = p.proposals[0]
  slot.versions[0].status = 'pending'
  slot.versions[0].label = 'Luxury UTEC'
  slot.versions.push({...slot.versions[0],id:'replacement',number:2,label:'Luxury original',imageUrl:'/versions/new/image'})
  const view = render(createElement(ImageContext.Provider, {value:async()=>new Blob(['photo'],{type:'image/png'})}, createElement(History,{project:p,onClose(){}})))
  fireEvent.click(view.getByRole('button', {name:'Ver imagen Luxury UTEC, versión 1'}))
  await waitFor(()=>assert.ok(view.getByRole('img', {name:'Luxury UTEC, versión 1'})))
  assert.ok(view.getAllByText('Sin decisión registrada').length > 0)
  assert.equal(p.events.length,0)
})

test('la galería aparece después del resumen con cinco versiones aprobadas y abre su vista ampliada', () => {
  const project = completedProject()
  const view = render(createElement(App, { remote: remoteView(project) }))
  const gallery = view.getByRole('region', { name: 'Diseños aprobados' })
  const summary = view.getByRole('region', { name: 'Resumen final de la sesión' })
  assert.ok(summary.compareDocumentPosition(gallery) & 4)
  assert.equal(gallery.querySelectorAll('figure').length, 5)
  fireEvent.click(view.getByRole('button', { name: 'Ampliar diseño aprobado Luxury, versión 1' }))
  assert.ok(view.getByRole('dialog', { name: 'Luxury · Versión 1' }))
})

test('rechazar oculta la galería hasta aceptar la sustituta y generar otro resumen', () => {
  let project = completedProject()
  const view = render(createElement(App, { remote: remoteView(project) }))
  assert.ok(view.getByRole('region', { name: 'Diseños aprobados' }))
  project = updateProject(project, { type: 'decide', position: 4, versionId: currentVersion(project.proposals[3]).id, status: 'rejected', reason: 'Conservar el techo' })
  view.rerender(createElement(App, { remote: remoteView(project) }))
  assert.equal(view.queryByRole('region', { name: 'Diseños aprobados' }), null)
  project = updateProject(project, { type: 'regenerated', position: 4, versionId: currentVersion(project.proposals[3]).id })
  currentVersion(project.proposals[3]).imageUrl = '/api/generations/session/versions/attic-v2/image'
  project = updateProject(project, { type: 'decide', position: 4, versionId: currentVersion(project.proposals[3]).id, status: 'accepted', reason: '' })
  view.rerender(createElement(App, { remote: remoteView(project) }))
  assert.equal(view.queryByRole('region', { name: 'Diseños aprobados' }), null)
  project = updateProject(project, { type: 'summarize' })
  view.rerender(createElement(App, { remote: remoteView(project) }))
  const gallery = view.getByRole('region', { name: 'Diseños aprobados' })
  assert.ok(gallery.textContent!.includes('Attic · V2'))
  assert.ok(!gallery.textContent!.includes('Attic · V1'))
})
