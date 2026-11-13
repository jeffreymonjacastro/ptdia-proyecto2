import { useEffect, useState } from 'react'
import { STYLES, currentVersion, type Proposal, type ProjectAction } from './domain.ts'
import { Icon, RoomImage, styleAccent } from './components.tsx'

export function ProposalCard({ proposal, paused, onAction, onPreview }: { proposal: Proposal; paused: boolean; onAction: (action: ProjectAction) => void; onPreview: () => void }) {
  const version = currentVersion(proposal)
  const [reason, setReason] = useState('')
  const [showReason, setShowReason] = useState(false)
  const busy = proposal.generation === 'generating'
  const failed = proposal.generation === 'failed'
  const style = STYLES[proposal.style]
  useEffect(() => { setReason(''); setShowReason(false) }, [version.id, version.status])
  useEffect(() => {
    if (!busy || paused) return
    // shortcut: la demo reutiliza la misma imagen; sustituir por la API de regeneración al integrar backend.
    const timeout = window.setTimeout(() => onAction({ type: 'regenerated', position: proposal.position, versionId: version.id }), 1600)
    return () => window.clearTimeout(timeout)
  }, [busy, paused, proposal.position, version.id, onAction])

  const decide = (status: 'accepted' | 'rejected') => {
    onAction({ type: 'decide', position: proposal.position, versionId: version.id, status, reason })
    setReason(''); setShowReason(false)
  }
  return <article className={`proposal-card ${version.status}`} style={styleAccent(proposal.style)} aria-label={`Propuesta ${style.name}`}>
    <button className="proposal-image-button" onClick={onPreview} aria-label={`Ampliar ${style.name}, versión ${version.number}`}>
      <RoomImage style={proposal.style} />
      <span className="image-example">Ejemplo</span><span className="expand-button"><Icon name="expand" size={16} /></span>
    </button>
    <div className="proposal-body">
      <div className="proposal-title"><h3>{style.name}</h3><span className="version">#{proposal.position} · V{version.number}</span>
        <span className={`decision-badge ${version.status}`}><Icon name={version.status === 'accepted' ? 'check' : version.status === 'rejected' ? 'close' : 'clock'} size={12} />{version.status === 'accepted' ? 'Aceptada' : version.status === 'rejected' ? 'Rechazada' : 'Pendiente'}</span>
      </div>
      <p className="proposal-description">{version.description}</p>
      {busy || failed ? <div className={`card-progress ${failed ? 'failed' : ''}`} role="status">
        {failed ? <><span>No se completó la nueva versión.</span><button className="text-button" disabled={paused} onClick={() => onAction({ type: 'retry', position: proposal.position, versionId: version.id })}><Icon name="refresh" size={14} /> Reintentar</button></>
          : <><span className={paused ? '' : 'spinner'} />{paused ? 'Regeneración en pausa' : 'Preparando nueva versión…'}</>}
      </div> : <>
        <div className="decision-actions">
          <button className={`decision-button accept ${version.status === 'accepted' ? 'selected' : ''}`} onClick={() => decide('accepted')} disabled={paused || version.status === 'accepted'} aria-label={`Aceptar ${style.name}`}><Icon name="check" size={16} />Aceptar</button>
          <button className="decision-button reject" onClick={() => decide('rejected')} disabled={paused} aria-label={`Rechazar ${style.name}`}><Icon name="close" size={15} />Rechazar</button>
        </div>
        <button className="reason-toggle" onClick={() => setShowReason(!showReason)} disabled={paused} aria-expanded={showReason}>
          <Icon name="plus" size={12} />{showReason ? 'Ocultar motivo' : 'Añadir motivo opcional'}
        </button>
        {showReason && <textarea className="reason-input" aria-label={`Motivo para ${style.name}`} placeholder="¿Qué te gusta o qué cambiarías?" value={reason} onChange={event => setReason(event.target.value)} maxLength={500} rows={2} disabled={paused} />}
      </>}
    </div>
  </article>
}
