import { useEffect, useRef, useState, type FormEvent } from 'react'
import { createProject, type Photo, type Project, type ProjectInput } from './domain.ts'
import { Dialog, Icon, PhotoImage } from './components.tsx'
import { readPhoto } from './photos.ts'

export function ProjectForm({ onClose, onCreate, onSubmitRemote }: { onClose: () => void; onCreate: (project: Project) => void; onSubmitRemote?: (input: ProjectInput) => Promise<void> }) {
  const [photo, setPhoto] = useState<Exclude<Photo,{kind:'remote'}> | undefined>(onSubmitRemote ? undefined : { kind: 'example', name: 'dormitorio-ejemplo.jpg' })
  const [error, setError] = useState('')
  const [formError, setFormError] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [consent, setConsent] = useState(false)
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
      if (request === sequence.current) { setPhoto(next); setConfirmed(false); setConsent(false) }
    } catch (cause) {
      if (request === sequence.current) setError(cause instanceof Error ? cause.message : 'No se pudo abrir la fotografía.')
    } finally { if (request === sequence.current) setReading(false) }
  }
  function useExample() {
    sequence.current++; setReading(false); setError('')
    setPhoto({ kind: 'example', name: 'dormitorio-ejemplo.jpg' })
    setConfirmed(false); setConsent(false)
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (creating || reading || error) return
    const data = new FormData(event.currentTarget)
    try {
      if (!photo) throw new Error('Selecciona una fotografía de dormitorio.')
      const input = { client: String(data.get('client') || ''), room: String(data.get('room') || ''),
        preferences: String(data.get('preferences') || ''), photo, consent: data.has('consent'), bedroomConfirmed: data.has('bedroom') }
      if (!input.client.trim()) throw new Error('Escribe el nombre del cliente.')
      if (onSubmitRemote) {
        setCreating(true)
        void onSubmitRemote(input).then(onClose).catch(cause => setFormError(cause instanceof Error ? cause.message : 'No se pudo enviar el proyecto.')).finally(() => setCreating(false))
        return
      }
      const project = createProject(input)
      setCreating(true)
      creationTimer.current = window.setTimeout(() => { onCreate(project); onClose() }, 900)
    } catch (cause) { setFormError(cause instanceof Error ? cause.message : 'No se pudo crear el proyecto.') }
  }
  return <Dialog title="Un nuevo comienzo" eyebrow="NUEVO PROYECTO" onClose={onClose} busy={!!onSubmitRemote && creating}>
    <p className="dialog-intro">Un dormitorio, cinco formas de imaginarlo. Empieza con una foto y revísala junto a tu cliente.</p>
    <form onSubmit={submit} onChange={() => setFormError('')} className="project-form">
      <fieldset disabled={creating}>
        <div className="form-row"><label>Nombre del cliente<input name="client" autoComplete="off" placeholder="Ej. Valeria Mendoza" maxLength={80} required autoFocus /></label>
          <label>Nombre del espacio<input name="room" defaultValue="Dormitorio principal" maxLength={80} required /></label></div>
        <div className="photo-picker" onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); if (!creating) void chooseFile(event.dataTransfer.files[0]) }}>
          {photo ? <PhotoImage photo={photo} /> : <span className="empty-photo"><Icon name="upload" size={28}/></span>}
          <div className="photo-picker-content"><span className="eyebrow">FOTOGRAFÍA ORIGINAL</span><strong>{!photo ? 'Tu dormitorio, el punto de partida' : photo.kind === 'example' ? 'Prueba con nuestro dormitorio' : photo.name}</strong>
            <p>{!photo ? 'Selecciona una foto o arrástrala aquí.' : photo.kind === 'example' ? 'Un ejemplo listo para explorar la demo.' : `${photo.width} × ${photo.height} px · ${onSubmitRemote ? 'Se enviará al servidor de tu proyecto.' : 'Se guarda en este navegador.'}`}</p>
            <button type="button" className="button secondary" onClick={() => fileInput.current?.click()} disabled={reading}><Icon name="upload" size={16} />{reading ? 'Validando foto…' : 'Subir fotografía'}</button>
          </div>
        </div>
        <input ref={fileInput} className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" aria-label="Seleccionar fotografía de dormitorio" onChange={event => { void chooseFile(event.target.files?.[0]); event.target.value = '' }} />
        <div className="upload-caption"><span>JPG, PNG o WebP · hasta 10 MB y 25 MP</span>{!onSubmitRemote && (photo?.kind === 'upload' || error) && <button type="button" className="text-button" onClick={useExample}>Usar el ejemplo</button>}</div>
        <label>Preferencias <span className="optional">opcional</span><textarea name="preferences" placeholder="Colores, materiales, iluminación o elementos que quieren conservar…" rows={3} maxLength={2000} /></label>
        <div className="scope-note"><Icon name="bed" size={20} /><div><strong>Solo habitaciones / dormitorios</strong><p>{onSubmitRemote ? 'Incluye la cama y una vista clara de la habitación.' : 'La demo no identifica el contenido de tu foto. Confirma que es un dormitorio.'}</p></div></div>
        <label className="checkbox-label"><input type="checkbox" name="bedroom" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} required /><span>Confirmo que la fotografía muestra un dormitorio.</span></label>
        <label className="checkbox-label"><input type="checkbox" name="consent" checked={consent} onChange={event => setConsent(event.target.checked)} required /><span>{onSubmitRemote ? 'Tengo autorización para enviar esta foto y guardar las propuestas y decisiones de forma privada en mi cuenta. Puedo eliminar el proyecto cuando quiera.' : 'Tengo autorización para usar esta foto y guardarla con las decisiones en este navegador. Puedo eliminar el proyecto cuando quiera.'}</span></label>
      </fieldset>
      {(error || formError) && <p className="error-message" role="alert">{error || formError}</p>}
      <div className="form-footer"><span><Icon name="info" size={14} />{onSubmitRemote ? 'El proceso puede tardar varios minutos.' : 'Propuestas de ejemplo, sin generación de IA.'}</span><button className="button primary" type="submit" disabled={creating || reading || !!error || !photo}>{creating ? <><span className="spinner" />{onSubmitRemote ? 'Enviando fotografía…' : 'Preparando cinco propuestas…'}</> : <><Icon name="sparkle" size={16} />Crear proyecto</>}</button></div>
    </form>
  </Dialog>
}
