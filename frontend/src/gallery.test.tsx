import test, { afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { Window } from 'happy-dom'
import { unzipSync } from 'fflate'
import { createProject, currentVersion, updateProject } from './domain.ts'

const dom = new Window({ url: 'http://localhost:5173' })
Object.defineProperties(globalThis, {
  window: { value: dom, configurable: true }, document: { value: dom.document, configurable: true },
  navigator: { value: dom.navigator, configurable: true }, HTMLElement: { value: dom.HTMLElement, configurable: true },
  MutationObserver: { value: dom.MutationObserver, configurable: true },
})
const { createElement, useLayoutEffect } = await import('react')
const { render, fireEvent, cleanup, waitFor, act } = await import('@testing-library/react')
const { ApprovedGallery } = await import('./ApprovedGallery.tsx')
const { ImageContext } = await import('./PrivateImage.tsx')
afterEach(() => cleanup())

function completed() {
  let project = createProject({ client: 'A', room: 'Dormitorio', preferences: '', photo: { kind: 'example', name: 'example.jpg' }, consent: true, bedroomConfirmed: true })
  for (const proposal of project.proposals) project = updateProject(project, { type: 'decide', position: proposal.position, versionId: currentVersion(proposal).id, status: 'accepted', reason: '' })
  project.proposals.forEach(proposal => { currentVersion(proposal).imageUrl = `/versions/${proposal.style}` })
  return updateProject(project, { type: 'summarize' })
}

test('las descargas individuales y ZIP usan solo las imágenes aprobadas originales', async t => {
  const project = completed()
  const blobs = new Map<string, Blob>()
  const saves: { name: string; blob: Blob }[] = []
  t.mock.method(URL, 'createObjectURL', (blob: Blob) => { const url = `blob:${blobs.size}`; blobs.set(url, blob); return url })
  t.mock.method(dom.HTMLAnchorElement.prototype, 'click', function(this: HTMLAnchorElement) { saves.push({ name: this.download, blob: blobs.get(this.href)! }) })
  const load = async (path: string) => new Blob([path], { type: path.endsWith('japanese') ? 'image/jpeg' : 'image/png' })
  const view = render(createElement(ImageContext.Provider, { value: load }, createElement(ApprovedGallery, { project, connected: true, onPreview() {} })))
  fireEvent.click(view.getByRole('button', { name: 'Descargar imagen Japanese, versión 1' }))
  await waitFor(() => assert.equal(saves.length, 1))
  assert.equal(saves[0].name, 'japanese-v1.jpg')
  assert.equal(await saves[0].blob.text(), '/versions/japanese')
  const downloadAll = view.getByRole('button', { name: 'Descargar todas' }) as HTMLButtonElement
  await waitFor(() => assert.equal(downloadAll.disabled, false))
  fireEvent.click(downloadAll)
  await waitFor(() => assert.equal(saves.length, 2))
  assert.match(saves[1].name, /^disenos-aprobados-.+\.zip$/)
  const files = unzipSync(new Uint8Array(await saves[1].blob.arrayBuffer()))
  assert.deepEqual(Object.keys(files), ['luxury-v1.png', 'japanese-v1.jpg', 'neo-classic-v1.png', 'attic-v1.png', 'cyberpunk-v1.png'])
  assert.equal(new TextDecoder().decode(files['attic-v1.png']), '/versions/attic')
})

test('un fallo no descarga un ZIP parcial y permite reintentar', async t => {
  const project = completed()
  let fail = true
  let saves = 0
  t.mock.method(dom.HTMLAnchorElement.prototype, 'click', () => { saves++ })
  const load = async (path: string) => { if (fail && path.endsWith('attic')) throw new Error('Sin conexión'); return new Blob([path], { type: 'image/png' }) }
  const view = render(createElement(ImageContext.Provider, { value: load }, createElement(ApprovedGallery, { project, connected: true, onPreview() {} })))
  fireEvent.click(view.getByRole('button', { name: 'Descargar todas' }))
  await waitFor(() => assert.match(view.getByRole('alert').textContent!, /Sin conexión/))
  assert.equal(saves, 0)
  fail = false
  fireEvent.click(view.getByRole('button', { name: 'Descargar todas' }))
  await waitFor(() => assert.equal(saves, 1))
  assert.equal(view.queryByRole('alert'), null)
})

test('invalidar o desmontar la galería aborta descargas y evita guardar respuestas tardías', async t => {
  for (const action of ['invalidate', 'unmount'] as const) {
    const project = completed()
    let slow = false
    const requests: { signal?: AbortSignal; resolve: (value: Blob) => void }[] = []
    let saves = 0
    t.mock.method(dom.HTMLAnchorElement.prototype, 'click', () => { saves++ })
    const load = (path: string, signal?: AbortSignal) => slow ? new Promise<Blob>(resolve => { requests.push({ signal, resolve }) }) : Promise.resolve(new Blob([path], { type: 'image/png' }))
    const element = (p = project) => createElement(ImageContext.Provider, { value: load }, createElement(ApprovedGallery, { project: p, connected: true, onPreview() {} }))
    const view = render(element())
    await waitFor(() => assert.equal(view.getAllByRole('img').length, 5))
    slow = true
    fireEvent.click(view.getByRole('button', { name: 'Descargar todas' }))
    await waitFor(() => assert.ok(requests.length > 0))
    if (action === 'unmount') view.unmount()
    else view.rerender(element({ ...project, summary: undefined }))
    assert.ok(requests.every(request => request.signal?.aborted))
    await act(async () => { requests.forEach(request => request.resolve(new Blob(['late'], { type: 'image/png' }))) })
    assert.equal(saves, 0)
    view.unmount()
  }
})

test('la demo muestra ejemplos y vistas ampliadas sin ofrecer descargas reales', () => {
  const project = completed()
  let preview = ''
  const view = render(createElement(ApprovedGallery, { project, connected: false, onPreview: style => { preview = style } }))
  assert.ok(view.getByText(/Imágenes de ejemplo/))
  assert.equal(view.queryByRole('button', { name: 'Descargar todas' }), null)
  fireEvent.click(view.getByRole('button', { name: 'Ampliar diseño aprobado Attic, versión 1' }))
  assert.equal(preview, 'attic')
})

test('la descarga se aborta durante el commit que elimina la galería', async () => {
  const project = completed()
  let slow = false
  let requestSignal: AbortSignal | undefined
  let resolveDownload: ((blob: Blob) => void) | undefined
  let abortedAtRemoval = false
  const load = (path: string, signal?: AbortSignal) => slow ? new Promise<Blob>(resolve => { requestSignal = signal; resolveDownload = resolve }) : Promise.resolve(new Blob([path], { type: 'image/png' }))
  function Fixture({ visible }: { visible: boolean }) {
    useLayoutEffect(() => { if (!visible) abortedAtRemoval = requestSignal?.aborted === true }, [visible])
    return createElement(ImageContext.Provider, { value: load }, visible ? createElement(ApprovedGallery, { project, connected: true, onPreview() {} }) : null)
  }
  const view = render(createElement(Fixture, { visible: true }))
  await waitFor(() => assert.equal(view.getAllByRole('img').length, 5))
  slow = true
  fireEvent.click(view.getByRole('button', { name: 'Descargar imagen Luxury, versión 1' }))
  await waitFor(() => assert.ok(resolveDownload))
  view.rerender(createElement(Fixture, { visible: false }))
  assert.equal(abortedAtRemoval, true)
  await act(async () => resolveDownload!(new Blob(['late'], { type: 'image/png' })))
})

test('una imagen vigente sin ruta no se sustituye por un ejemplo descargable', () => {
  const project = completed()
  delete currentVersion(project.proposals[0]).imageUrl
  const view = render(createElement(ApprovedGallery, { project, connected: true, onPreview() {} }))
  assert.equal(view.queryByRole('region', { name: 'Diseños aprobados' }), null)
})
