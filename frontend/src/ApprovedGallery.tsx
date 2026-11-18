import { useContext, useLayoutEffect, useRef, useState } from 'react'
import { Icon, RoomImage } from './components.tsx'
import { STYLES, type Project, type Style } from './domain.ts'
import { approvedVersions, buildImageZip, imageFilename, saveDownload } from './downloads.ts'
import { ImageContext, PrivateImage } from './PrivateImage.tsx'

export function ApprovedGallery({ project, connected, onPreview }: { project: Project; connected: boolean; onPreview: (style: Style) => void }) {
  const rows = approvedVersions(project)
  if (!rows.length || (connected && rows.some(row => !row.version.imageUrl))) return null
  const selection = JSON.stringify([project.id, project.revision, connected, ...rows.map(row => [row.version.id, row.version.imageUrl])])
  return <Gallery key={selection} rows={rows} projectId={project.id} connected={connected} onPreview={onPreview}/>
}

function Gallery({ rows, projectId, connected, onPreview }: { rows: ReturnType<typeof approvedVersions>; projectId: string; connected: boolean; onPreview: (style: Style) => void }) {
  const load = useContext(ImageContext)
  const request = useRef<AbortController | null>(null)
  const [pending, setPending] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  useLayoutEffect(() => () => { request.current?.abort() }, [load])

  async function download(position?: number) {
    if (!load || request.current) return
    const abort = new AbortController()
    request.current = abort
    setPending(position ? String(position) : 'all')
    setError(''); setNotice('')
    try {
      const selected = position ? rows.filter(row => row.proposal.position === position) : rows
      const images = await Promise.all(selected.map(async ({ proposal, version }) => {
        const blob = await load!(version.imageUrl!, abort.signal)
        return { filename: imageFilename(proposal.style, version.number, blob.type), blob }
      }))
      const blob = position ? images[0].blob : await buildImageZip(images)
      if (abort.signal.aborted) return
      saveDownload(blob, position ? images[0].filename : `disenos-aprobados-${projectId}.zip`)
      setNotice(position ? 'Descarga iniciada.' : 'Descarga de las cinco imágenes iniciada.')
    } catch (cause) {
      if (!abort.signal.aborted) {
        setError(cause instanceof Error ? cause.message : 'No se pudo preparar la descarga. Vuelve a intentarlo.')
        abort.abort()
      }
    } finally {
      if (request.current === abort) { request.current = null; setPending('') }
    }
  }

  return <section className="approved-gallery" aria-label="Diseños aprobados">
    <div className="approved-gallery-heading"><div><p className="eyebrow">TU SELECCIÓN FINAL</p><h2>Diseños aprobados</h2><p>{connected ? 'Cinco propuestas para guardar y compartir.' : 'Imágenes de ejemplo. Las descargas están disponibles para propuestas generadas en modo conectado.'}</p></div>
      {connected && <button className="button secondary" disabled={!!pending || !load} onClick={() => void download()}><Icon name="download" size={16}/>{pending === 'all' ? 'Preparando ZIP…' : 'Descargar todas'}</button>}
    </div>
    <div className="approved-gallery-grid">{rows.map(({ proposal, version }) => {
      const label = proposal.label || STYLES[proposal.style].name
      return <figure key={version.id}>
        <button className="approved-image-button" onClick={() => onPreview(proposal.style)} aria-label={`Ampliar diseño aprobado ${label}, versión ${version.number}`}>
          {connected ? <PrivateImage path={version.imageUrl!} alt={`${label}, versión ${version.number} aprobada`} retryable={false}/> : <RoomImage style={proposal.style}/>}
          <span className="expand-button"><Icon name="expand" size={16}/></span>
        </button>
        <figcaption><span><Icon name="check" size={14}/>{label} · V{version.number}</span>
          {connected && <button className="text-button" disabled={!!pending || !load} onClick={() => void download(proposal.position)} aria-label={`Descargar imagen ${label}, versión ${version.number}`}><Icon name="download" size={14}/>{pending === String(proposal.position) ? 'Preparando…' : 'Descargar imagen'}</button>}
        </figcaption>
      </figure>
    })}</div>
    {pending && <p className="approved-gallery-notice" role="status"><span className="spinner"/>Preparando {pending === 'all' ? 'las cinco imágenes' : 'la imagen'}…</p>}
    {notice && <p className="approved-gallery-notice" role="status">{notice}</p>}
    {error && <p className="error-message" role="alert">{error} Puedes volver a intentar la descarga.</p>}
  </section>
}
