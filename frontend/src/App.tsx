import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { STYLES, canSummarize, currentVersion, updateProject, type Project, type ProjectAction, type Style } from './domain.ts'
import { Dialog, Icon, Mark, PhotoImage, RoomImage } from './components.tsx'
import { ProposalCard } from './ProposalCard.tsx'
import { ProjectForm } from './ProjectForm.tsx'
import { History } from './History.tsx'
import { useWorkspace } from './useWorkspace.ts'

export default function App() {
  const { workspace, setWorkspace, saving, storageError, retrySave } = useWorkspace()
  const [search, setSearch] = useState('')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [dialog, setDialog] = useState<'new' | 'demo' | 'profile' | 'delete' | null>(null)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [mobile, setMobile] = useState(() => window.matchMedia('(max-width: 760px)').matches)
  const sidebar = useRef<HTMLElement>(null)
  useEffect(() => {
    const media = window.matchMedia('(max-width: 760px)')
    const change = () => { setMobile(media.matches); setSidebarOpen(false) }
    media.addEventListener('change', change)
    return () => media.removeEventListener('change', change)
  }, [])
  useEffect(() => {
    if (!mobile || !sidebarOpen) return
    const previous = document.activeElement as HTMLElement | null
    const items = () => Array.from(sidebar.current!.querySelectorAll<HTMLElement>('a, button, input')).filter(item => !item.hasAttribute('disabled'))
    items()[0]?.focus()
    const trap = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setSidebarOpen(false); return }
      if (event.key !== 'Tab') return
      const focusable = items()
      const first = focusable[0], last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }
    document.addEventListener('keydown', trap)
    return () => { document.removeEventListener('keydown', trap); previous?.focus() }
  }, [mobile, sidebarOpen])
  const activeId = workspace?.activeId
  const onAction = useCallback((action: ProjectAction) => {
    setWorkspace(previous => previous && { ...previous, projects: previous.projects.map(p => p.id === activeId ? updateProject(p, action) : p) })
  }, [activeId, setWorkspace])
  if (!workspace) return <div className="app-loading" role="status"><Icon name="bed" size={36} /><p>Abriendo tu estudio…</p></div>
  const project = workspace.projects.find(p => p.id === activeId)
  const matches = workspace.projects.filter(p => `${p.client} ${p.room}`.toLocaleLowerCase('es').includes(search.toLocaleLowerCase('es')))
  const select = (id: string) => { setWorkspace(previous => previous && { ...previous, activeId: id }); setSidebarOpen(false); setHistoryOpen(false) }
  function addProject(next: Project) { setWorkspace(previous => previous && { ...previous, projects: [next, ...previous.projects], activeId: next.id }); setSidebarOpen(false); setSearch('') }
  function deleteProject() {
    setWorkspace(previous => {
      if (!previous) return previous
      const projects = previous.projects.filter(p => p.id !== activeId)
      return { ...previous, projects, activeId: projects[0]?.id ?? null }
    })
    setHistoryOpen(false); setDialog(null)
  }
  return <div className="studio-app">
    {sidebarOpen && <button className="sidebar-scrim" onClick={() => setSidebarOpen(false)} aria-label="Cerrar proyectos" />}
    <aside ref={sidebar} className={`sidebar ${sidebarOpen ? 'open' : ''}`} aria-label="Proyectos de clientes" inert={mobile && !sidebarOpen} role={mobile && sidebarOpen ? 'dialog' : undefined} aria-modal={mobile && sidebarOpen ? true : undefined}>
      <a className="brand" href="./" aria-label="Estudio, inicio"><span className="brand-icon"><Icon name="bed" size={29} /></span><div>estudio<span>ESPACIOS CON INTENCIÓN</span></div></a>
      <button className="sidebar-close icon-button" onClick={() => setSidebarOpen(false)} aria-label="Cerrar proyectos"><Icon name="close" /></button>
      <button className="new-project" onClick={() => { setSidebarOpen(false); setDialog('new') }}><Icon name="plus" size={18} />Nuevo proyecto<span aria-hidden="true">＋</span></button>
      <div className="search-box"><Icon name="search" size={16} /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Buscar cliente" aria-label="Buscar cliente" />{search && <button onClick={() => setSearch('')} aria-label="Limpiar búsqueda"><Icon name="close" size={13} /></button>}</div>
      <div className="sidebar-label"><span>CLIENTES</span><span>{workspace.projects.length}</span></div>
      <nav className="project-list" aria-label="Seleccionar proyecto">
        {matches.map(p => <button key={p.id} className={`project-item ${p.id === activeId ? 'active' : ''}`} onClick={() => select(p.id)} aria-current={p.id === activeId ? 'page' : undefined}>
          <Icon name="folder" size={20} /><span><strong>{p.client}</strong><small>{p.room}</small></span>{p.status === 'completed' && <Icon name="check" size={13} className="project-complete" />}{p.status === 'paused' && <Icon name="pause" size={13} />}
        </button>)}
        {!matches.length && <p className="no-projects">{search ? 'No encontramos ese cliente.' : 'Tu próximo proyecto empieza aquí.'}</p>}
      </nav>
      <div className="sidebar-bottom"><div className="local-note"><span className="status-dot" /><span>{saving ? 'Guardando cambios…' : storageError ? 'Cambios sin guardar' : 'Guardado en este navegador'}<small>Tu estudio, a tu ritmo.</small></span></div>
        <button className="designer-profile" onClick={() => setDialog('profile')}><span className="avatar">{workspace.designer.charAt(0).toUpperCase()}</span><span><strong>{workspace.designer}</strong><small>Diseñadora · acceso demo</small></span><Icon name="chevron" size={15} /></button>
      </div>
    </aside>
    <main className="main-panel" inert={mobile && sidebarOpen}>
      <header className="topbar">
        <button className="icon-button mobile-menu" onClick={() => setSidebarOpen(!sidebarOpen)} aria-label="Mostrar proyectos" aria-expanded={sidebarOpen}><Icon name="menu" /></button>
        <div className="breadcrumb"><Icon name="folder" size={18} /><span>{project?.client || 'Tu estudio'}<span className="breadcrumb-divider">/</span><strong>{project?.room || 'Proyectos de dormitorios'}</strong></span></div>
        <div className="topbar-actions"><button className="demo-badge" onClick={() => setDialog('demo')}><span className="status-dot" />Modo demo</button>
          {project && <button className="button history-button" aria-label="Ver historial" onClick={() => setHistoryOpen(true)}><Icon name="clock" size={16} /><span>Ver historial</span></button>}
        </div>
      </header>
      {storageError && <div className="storage-warning" role="alert"><Icon name="info" size={17} /><p>{storageError}</p><button onClick={() => void retrySave()}>Reintentar</button></div>}
      {project ? <Workbench key={project.id} project={project} onAction={onAction} onNew={() => setDialog('new')} onDelete={() => setDialog('delete')} />
        : <div className="empty-studio"><Mark /><p className="eyebrow">UN ESPACIO POR IMAGINAR</p><h1>El próximo dormitorio<br />empieza contigo.</h1><p>Crea un proyecto y explora cinco estilos con tu cliente.</p><button className="button primary" onClick={() => setDialog('new')}><Icon name="plus" />Nuevo proyecto</button></div>}
    </main>
    {dialog === 'new' && <ProjectForm onClose={() => setDialog(null)} onCreate={addProject} />}
    {historyOpen && project && <History project={project} onClose={() => setHistoryOpen(false)} />}
    {dialog === 'demo' && <Dialog title="Un estudio para probar" eyebrow="MODO DEMOSTRACIÓN" onClose={() => setDialog(null)}>
      <div className="demo-explanation"><Mark /><p>Explora el recorrido completo sin conectarte a un servidor.</p><ul><li>Las cinco imágenes y sus descripciones son ejemplos del mockup.</li><li>Rechazar crea una nueva versión pendiente del mismo ejemplo, sin modificar las otras propuestas.</li><li>El resumen se construye con tus decisiones; todavía no interviene una IA.</li><li>Las fotografías y el historial se guardan en este navegador. No se envían a ningún servidor.</li></ul><p className="muted">El acceso es ilustrativo. Esta demo no ofrece cuentas privadas ni autenticación; cualquier persona que use este perfil del navegador puede abrir sus proyectos.</p></div>
      <button className="button primary full-width" onClick={() => setDialog(null)}>Volver al estudio</button>
    </Dialog>}
    {dialog === 'profile' && <Dialog title="Tu espacio de diseño" eyebrow="ACCESO DE DEMOSTRACIÓN" onClose={() => setDialog(null)}>
      <p className="dialog-intro">Personaliza el nombre que aparece en el estudio. Es un perfil local de demostración, sin contraseña ni cuenta privada.</p>
      <form className="profile-form" onSubmit={event => { event.preventDefault(); const name = String(new FormData(event.currentTarget).get('designer') || '').trim(); if (!name) return; setWorkspace(previous => previous && { ...previous, designer: name }); setDialog(null) }}>
        <label>Tu nombre<input name="designer" defaultValue={workspace.designer} maxLength={60} required autoFocus /></label><button className="button primary" type="submit">Entrar al estudio</button>
      </form>
    </Dialog>}
    {dialog === 'delete' && project && <Dialog title="¿Eliminar este proyecto?" eyebrow="BORRAR DE ESTE NAVEGADOR" onClose={() => setDialog(null)}>
      <p className="dialog-intro">Se eliminarán la foto, las versiones y las decisiones de <strong>{project.client} / {project.room}</strong> del historial local. Esta acción no se puede deshacer.</p>
      <div className="confirmation-actions"><button className="button secondary" onClick={() => setDialog(null)}>Conservar proyecto</button><button className="button danger" onClick={deleteProject}><Icon name="trash" size={16} />Eliminar proyecto</button></div>
    </Dialog>}
  </div>
}

function Workbench({ project, onAction, onNew, onDelete }: { project: Project; onAction: (action: ProjectAction) => void; onNew: () => void; onDelete: () => void }) {
  const [prompt, setPrompt] = useState('')
  const [preview, setPreview] = useState<Style | 'original' | null>(null)
  const [copyStatus, setCopyStatus] = useState('')
  const end = useRef<HTMLDivElement>(null)
  const composer = useRef<HTMLTextAreaElement>(null)
  const paused = project.status === 'paused'
  const accepted = project.proposals.filter(p => currentVersion(p).status === 'accepted').length
  const rejected = project.events.filter(e => e.status === 'rejected')
  function send(event: FormEvent) {
    event.preventDefault()
    if (!prompt.trim() || paused) return
    onAction({ type: 'feedback', text: prompt })
    setPrompt('')
    window.setTimeout(() => end.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }), 50)
    composer.current?.focus()
  }
  async function copySummary() {
    try { await navigator.clipboard.writeText(project.summary!.text); setCopyStatus('Copiado') }
    catch { setCopyStatus('No se pudo copiar. Selecciona el texto del registro.') }
  }
  return <>
    <div className="conversation-scroll">
      <div className="conversation-content">
        <div className="session-meta"><span className="session-label"><span className={`status-dot ${paused ? 'paused' : ''}`} />{paused ? 'Sesión en pausa' : project.status === 'completed' ? 'Selección completada' : 'Sesión de diseño'}<span className="meta-separator">·</span><span className="scope-tag">Solo dormitorios</span></span>
          <div className="session-actions"><button className="text-button" onClick={() => onAction({ type: paused ? 'resume' : 'pause' })}><Icon name={paused ? 'play' : 'pause'} size={13} />{paused ? 'Reanudar' : 'Pausar'}</button><button className="icon-button delete-project" onClick={onDelete} aria-label="Eliminar proyecto"><Icon name="trash" size={14} /></button></div>
        </div>
        <div className="user-message"><p>{project.messages[0]?.text || project.preferences || 'Queremos explorar cinco estilos para este dormitorio.'}</p><button className="attachment-chip" onClick={() => setPreview('original')}><Icon name="attach" size={15} /><span>{project.photo.name}</span><span className="attachment-type">{project.photo.kind === 'example' ? 'Ejemplo' : 'Original'}</span></button></div>
        <section className="assistant-message" aria-label="Propuestas de diseño">
          <div className="assistant-heading"><Mark /><div><strong>Cinco maneras de habitar el mismo espacio.</strong><p>Revisemos colores, materiales e iluminación. Tú y tu cliente deciden.</p></div></div>
          <div className="proposals-grid">
            {project.proposals.map(proposal => <ProposalCard key={proposal.position} proposal={proposal} paused={paused} onAction={onAction} onPreview={() => setPreview(proposal.style)} />)}
            <div className="gallery-note"><span className="line-decoration" /><Icon name="bed" size={28} /><p>La misma habitación.<br /><em>Una nueva perspectiva.</em></p><span>5 estilos · tu criterio</span></div>
          </div>
          <p className="demo-gallery-caption"><Icon name="info" size={13} />Imágenes de ejemplo. La demo no transforma tu fotografía; cada regeneración reutiliza el mismo ejemplo.</p>
        </section>
        <section className="selection-progress" aria-label="Progreso de selección"><div className="progress-heading"><span role="status"><Icon name="check" size={16} /><strong>{accepted} de 5</strong> propuestas aceptadas</span><div className="progress-dots" aria-hidden="true">{project.proposals.map(p => <span key={p.position} className={currentVersion(p).status === 'accepted' ? 'done' : ''} />)}</div></div>
          <div className="progress-bottom"><p>{paused ? 'Reanuda la sesión para continuar revisando.' : accepted === 5 ? 'Todo listo. Revisa el resumen de tus decisiones.' : 'Al rechazar, se prepara solo una nueva versión. Las aceptadas se conservan.'}</p><button className="summary-button" disabled={!canSummarize(project)} onClick={() => { onAction({ type: 'summarize' }); window.setTimeout(() => end.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }), 50) }}><Icon name="sparkle" size={15} />{project.summary ? 'Actualizar resumen' : 'Resumen final'}<Icon name="chevron" size={13} /></button></div>
        </section>
        {project.messages.slice(1).map(message => <div className="feedback-exchange" key={message.id}><div className="user-message"><p>{message.text}</p></div><div className="assistant-feedback"><Mark small /><p>Preferencia anotada para las próximas versiones. Tus propuestas aceptadas se conservan. <span>Respuesta de demostración.</span></p></div></div>)}
        {rejected.length > 0 && <details className="rejections-summary"><summary><Icon name="clock" size={15} />{rejected.length} {rejected.length === 1 ? 'rechazo registrado' : 'rechazos registrados'}<Icon name="chevron" size={13} /></summary><ul>{rejected.map(event => {
          const p = project.proposals.find(p => p.position === event.position)!
          const v = p.versions.find(v => v.id === event.versionId)!
          return <li key={event.id}><span>{STYLES[p.style].name} · V{v.number}</span>{event.reason || 'Sin motivo indicado.'}</li>
        })}</ul></details>}
        {project.summary && <section className="final-summary" aria-label="Resumen final de la sesión"><div className="final-summary-heading"><Mark /><div><p className="eyebrow">SELECCIÓN COMPLETADA</p><h2>Un dormitorio, cinco posibilidades.</h2></div><button className="icon-button" onClick={() => void copySummary()} aria-label="Copiar resumen"><Icon name="copy" size={17} /></button></div>
          <p>Las cinco propuestas actuales están aceptadas. Este resumen de demostración refleja el registro de decisiones.</p>
          <div className="accepted-styles">{project.proposals.map(p => <span key={p.position}><Icon name="check" size={13} />{STYLES[p.style].name} · V{currentVersion(p).number}</span>)}</div>
          <p className="muted">{rejected.length ? `${rejected.length === 1 ? 'Se conserva 1 rechazo' : `Se conservan ${rejected.length} rechazos`} en el historial, con sus motivos cuando se indicaron.` : 'No se registraron rechazos.'} No se atribuyen preferencias adicionales.</p>
          <details><summary>Ver registro del resumen</summary><pre>{project.summary.text}</pre></details>{copyStatus && <p role="status" className="copy-status">{copyStatus}</p>}
        </section>}
        <div ref={end} />
      </div>
    </div>
    <footer className="composer-area"><form className="composer" onSubmit={send}><button type="button" className="icon-button attach-button" onClick={onNew} aria-label="Crear proyecto con otra fotografía"><Icon name="plus" size={21} /></button><div className="composer-divider" />
      <label className="sr-only" htmlFor="client-prompt">Preferencias del cliente</label><textarea ref={composer} id="client-prompt" placeholder={paused ? 'La sesión está en pausa. Reanúdala para continuar.' : 'Describe qué quiere cambiar tu cliente…'} rows={1} maxLength={2000} value={prompt} disabled={paused} onChange={event => setPrompt(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); event.currentTarget.form?.requestSubmit() } }} />
      <button type="submit" className="send-button" disabled={paused || !prompt.trim()} aria-label="Enviar preferencias"><Icon name="arrow" size={19} /></button></form>
      <p className="composer-caption">Solo dormitorios<span>·</span>Tú y tu cliente tienen la última palabra.<span className="composer-demo">Demo local</span></p>
    </footer>
    {preview && <Dialog title={preview === 'original' ? 'Fotografía original' : `${STYLES[preview].name} · Versión ${currentVersion(project.proposals.find(p => p.style === preview)!).number}`} eyebrow={preview === 'original' ? project.photo.name : 'PROPUESTA DE EJEMPLO'} onClose={() => setPreview(null)} wide>
      {preview === 'original' ? <PhotoImage photo={project.photo} className="preview-image" /> : <RoomImage style={preview} className="preview-image" />}
      <p className="preview-caption">{preview === 'original' && project.photo.kind === 'upload' ? 'Fotografía guardada únicamente en este navegador.' : 'Imagen ilustrativa del mockup; no es una transformación generada de tu fotografía.'}</p>
    </Dialog>}
  </>
}
