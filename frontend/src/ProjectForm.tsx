import { useEffect, useRef, useState, type FormEvent } from 'react'
import { createProject, type Photo, type Project } from './domain.ts'
import { Dialog, Icon, PhotoImage } from './components.tsx'
import { readPhoto } from './photos.ts'

export function ProjectForm({ onClose, onCreate }: { onClose: () => void; onCreate: (project: Project) => void }) {
  const [photo, setPhoto] = useState<Photo>({ kind: 'example', name: 'dormitorio-ejemplo.jpg' })
  const [error, setError] = useState('')
  const [reading, setReading] = useState(false)
  const [creating, setCreating] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const sequence = useRef(0)
  const creationTimer = useRef<number | undefined>(undefined)
  useEffect(() => () => { sequence.current++; window.clearTimeout(creationTimer.current) }, [])

  async function chooseFile(file?: File) {
    if (!file) return
    const request = ++sequence.current
    setReading(true); setError('')
    try {
      const next = await readPhoto(file)
      if (request === sequence.current) setPhoto(next)
    } catch (cause) {
      if (request === sequence.current) setError(cause instanceof Error ? cause.message : 'No se pudo abrir la fotografía.')
    } finally { if (request === sequence.current) setReading(false) }
  }
  function useExample() {
    sequence.current++; setReading(false); setError('')
    setPhoto({ kind: 'example', name: 'dormitorio-ejemplo.jpg' })
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (creating || reading || error) return
    const data = new FormData(event.currentTarget)
    try {
      const project = createProject({ client: String(data.get('client') || ''), room: String(data.get('room') || ''),
        preferences: String(data.get('preferences') || ''), photo, consent: data.has('consent'), bedroomConfirmed: data.has('bedroom') })
      setCreating(true)
      creationTimer.current = window.setTimeout(() => { onCreate(project); onClose() }, 900)
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo crear el proyecto.') }
  }
  return <Dialog title="Un nuevo comienzo" eyebrow="NUEVO PROYECTO" onClose={onClose}>
    <p className="dialog-intro">Un dormitorio, cinco formas de imaginarlo. Empieza con una foto y revísala junto a tu cliente.</p>
    <form onSubmit={submit} className="project-form">
      <fieldset disabled={creating}>
        <div className="form-row"><label>Nombre del cliente<input name="client" autoComplete="off" placeholder="Ej. Valeria Mendoza" maxLength={80} required autoFocus /></label>
          <label>Nombre del espacio<input name="room" defaultValue="Dormitorio principal" maxLength={80} required /></label></div>
        <div className="photo-picker" onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); if (!creating) void chooseFile(event.dataTransfer.files[0]) }}>
          <PhotoImage photo={photo} />
          <div className="photo-picker-content"><span className="eyebrow">FOTOGRAFÍA ORIGINAL</span><strong>{photo.kind === 'example' ? 'Prueba con nuestro dormitorio' : photo.name}</strong>
            <p>{photo.kind === 'example' ? 'Un ejemplo listo para explorar la demo.' : `${photo.width} × ${photo.height} px · Se guarda en este navegador.`}</p>
            <button type="button" className="button secondary" onClick={() => fileInput.current?.click()} disabled={reading}><Icon name="upload" size={16} />{reading ? 'Validando foto…' : 'Subir fotografía'}</button>
          </div>
        </div>
        <input ref={fileInput} className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" aria-label="Seleccionar fotografía de dormitorio" onChange={event => { void chooseFile(event.target.files?.[0]); event.target.value = '' }} />
        <div className="upload-caption"><span>JPG, PNG o WebP · hasta 10 MB y 25 MP</span>{(photo.kind === 'upload' || error) && <button type="button" className="text-button" onClick={useExample}>Usar el ejemplo</button>}</div>
        <label>Preferencias <span className="optional">opcional</span><textarea name="preferences" placeholder="Colores, materiales, iluminación o elementos que quieren conservar…" rows={3} maxLength={2000} /></label>
        <div className="scope-note"><Icon name="bed" size={20} /><div><strong>Solo habitaciones / dormitorios</strong><p>La demo no identifica el contenido de tu foto. Confirma que es un dormitorio.</p></div></div>
        <label className="checkbox-label"><input type="checkbox" name="bedroom" required /><span>Confirmo que la fotografía muestra un dormitorio.</span></label>
        <label className="checkbox-label"><input type="checkbox" name="consent" required /><span>Tengo autorización para usar esta foto y guardarla con las decisiones en este navegador. Puedo eliminar el proyecto cuando quiera.</span></label>
      </fieldset>
      {error && <p className="error-message" role="alert">{error}</p>}
      <div className="form-footer"><span><Icon name="info" size={14} /> Propuestas de ejemplo, sin generación de IA.</span><button className="button primary" type="submit" disabled={creating || reading || !!error}>{creating ? <><span className="spinner" /> Preparando cinco propuestas…</> : <><Icon name="sparkle" size={16} />Crear proyecto</>}</button></div>
    </form>
  </Dialog>
}
