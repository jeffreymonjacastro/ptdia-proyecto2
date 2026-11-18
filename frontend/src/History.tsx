import { STYLES, type Project } from './domain.ts'
import { Dialog, Icon, PhotoImage } from './components.tsx'
import { useState } from 'react'
import { PrivateImage } from './PrivateImage.tsx'

const dateFormat = new Intl.DateTimeFormat('es-PE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
const formatDate = (value: string) => Number.isNaN(Date.parse(value)) ? 'Fecha desconocida' : dateFormat.format(new Date(value))
export function History({ project, onClose }: { project: Project; onClose: () => void }) {
  const [shownVersion, setShownVersion] = useState<string | null>(null)
  return <Dialog title="Cada decisión cuenta" eyebrow="HISTORIAL DEL PROYECTO" onClose={onClose} drawer>
    <div className="history-project"><PhotoImage photo={project.photo} /><div><strong>{project.client}</strong><p>{project.room}</p><span>{project.events.length} decisiones · {project.proposals.reduce((count, p) => count + p.versions.length, 0)} versiones</span></div></div>
    <p className="history-note"><Icon name="info" size={16} />{project.photo.kind === 'remote' ? 'Decisiones y versiones recuperadas de tu cuenta.' : 'Historial local de demostración. Las versiones regeneradas reutilizan la imagen de ejemplo.'}</p>
    <section className="history-versions" aria-label="Versiones conservadas"><h3>Versiones conservadas</h3><ul>{project.proposals.flatMap(proposal => proposal.versions.map(version => {
      const label = version.label || proposal.label || STYLES[proposal.style].name
      const decision = project.events.filter(event => event.versionId === version.id).at(-1)
      return <li key={version.id}><strong>{label} · V{version.number}</strong><span>{decision ? decision.status === 'accepted' ? 'Aceptada' : 'Rechazada' : 'Sin decisión registrada'}</span>
        {version.imageUrl && <button className="text-button" onClick={() => setShownVersion(shownVersion === version.id ? null : version.id)} aria-expanded={shownVersion === version.id} aria-label={`${shownVersion === version.id ? 'Ocultar' : 'Ver'} imagen ${label}, versión ${version.number}`}>{shownVersion === version.id ? 'Ocultar imagen' : 'Ver imagen'}</button>}
        {shownVersion === version.id && version.imageUrl && <PrivateImage path={version.imageUrl} alt={`${label}, versión ${version.number}`}/>}
      </li>
    }))}</ul></section>
    <ol className="timeline">
      {[...project.events].reverse().map(event => {
        const proposal = project.proposals.find(p => p.position === event.position)!
        const version = proposal.versions.find(v => v.id === event.versionId)!
        return <li key={event.id} className={event.status}>
          <span className="timeline-icon"><Icon name={event.status === 'accepted' ? 'check' : 'close'} size={15} /></span>
          <div><div className="timeline-title"><strong>{version.label || proposal.label || STYLES[proposal.style].name} · V{version.number}</strong><time dateTime={event.createdAt}>{formatDate(event.createdAt)}</time></div>
            <p className={`history-decision ${event.status}`}>{event.status === 'accepted' ? 'Propuesta aceptada' : 'Propuesta rechazada'}</p>
            <p>{event.reason || 'Sin motivo indicado.'}</p><code>{version.id}</code>
          </div>
        </li>
      })}
      <li><span className="timeline-icon"><Icon name="folder" size={15} /></span><div><div className="timeline-title"><strong>Proyecto creado</strong><time dateTime={project.createdAt}>{formatDate(project.createdAt)}</time></div><p>{project.photo.kind === 'remote' ? 'Fotografía original y propuestas guardadas de forma privada.' : 'Cinco estilos de ejemplo. Todas las propuestas comenzaron pendientes.'}</p></div></li>
    </ol>
  </Dialog>
}
