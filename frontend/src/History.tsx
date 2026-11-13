import { STYLES, type Project } from './domain.ts'
import { Dialog, Icon, PhotoImage } from './components.tsx'

const dateFormat = new Intl.DateTimeFormat('es-PE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
export function History({ project, onClose }: { project: Project; onClose: () => void }) {
  return <Dialog title="Cada decisión cuenta" eyebrow="HISTORIAL DEL PROYECTO" onClose={onClose} drawer>
    <div className="history-project"><PhotoImage photo={project.photo} /><div><strong>{project.client}</strong><p>{project.room}</p><span>{project.events.length} decisiones · {project.proposals.reduce((count, p) => count + p.versions.length, 0)} versiones</span></div></div>
    <p className="history-note"><Icon name="info" size={16} /> Historial local de demostración. Las versiones regeneradas reutilizan la imagen de ejemplo.</p>
    <ol className="timeline">
      {[...project.events].reverse().map(event => {
        const proposal = project.proposals.find(p => p.position === event.position)!
        const version = proposal.versions.find(v => v.id === event.versionId)!
        return <li key={event.id} className={event.status}>
          <span className="timeline-icon"><Icon name={event.status === 'accepted' ? 'check' : 'close'} size={15} /></span>
          <div><div className="timeline-title"><strong>{STYLES[proposal.style].name} · V{version.number}</strong><time dateTime={event.createdAt}>{dateFormat.format(new Date(event.createdAt))}</time></div>
            <p className={`history-decision ${event.status}`}>{event.status === 'accepted' ? 'Propuesta aceptada' : 'Propuesta rechazada'}</p>
            <p>{event.reason || 'Sin motivo indicado.'}</p><code>{version.id}</code>
          </div>
        </li>
      })}
      <li><span className="timeline-icon"><Icon name="folder" size={15} /></span><div><div className="timeline-title"><strong>Proyecto creado</strong><time dateTime={project.createdAt}>{dateFormat.format(new Date(project.createdAt))}</time></div><p>Cinco estilos de ejemplo. Todas las propuestas comenzaron pendientes.</p></div></li>
    </ol>
  </Dialog>
}
