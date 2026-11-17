import { useEffect, useState } from 'react'
import { STYLES, currentVersion, type Proposal, type ProjectAction } from './domain.ts'
import { Dialog, Icon, RoomImage, styleAccent } from './components.tsx'
import { PrivateImage } from './PrivateImage.tsx'
import type { ActionHandler } from './useRemoteWorkspace.ts'

export function ProposalCard({ proposal, paused, onAction, onPreview, connected = false }: { proposal: Proposal; paused: boolean; onAction: ActionHandler; onPreview: () => void; connected?: boolean }) {
  const version = currentVersion(proposal)
  const [reason, setReason] = useState('')
  const [rejectionReason,setRejectionReason]=useState('')
  const [showReason, setShowReason] = useState(false)
  const [showRejection, setShowRejection] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const busy = proposal.generation === 'generating'
  const failed = proposal.generation === 'failed'
  const style = STYLES[proposal.style]
  useEffect(() => { setReason(''); setRejectionReason(''); setShowReason(false); setShowRejection(false) }, [version.id, version.status])
  useEffect(() => {
    if (connected || !busy || paused) return
    // shortcut: la demo reutiliza la misma imagen; sustituir por la API de regeneración al integrar backend.
    const timeout = window.setTimeout(() => onAction({ type: 'regenerated', position: proposal.position, versionId: version.id }), 1600)
    return () => window.clearTimeout(timeout)
  }, [connected, busy, paused, proposal.position, version.id, onAction])

  const decide = (status: 'accepted' | 'rejected') => {
    setError('')
    const reset = () => { setReason(''); setRejectionReason(''); setShowReason(false); setShowRejection(false); setPending(false) }
    try {
      const result = onAction({ type: 'decide', position: proposal.position, versionId: version.id, status, reason:status==='rejected'?rejectionReason:reason })
      if (result) { setPending(true); void result.then(reset, cause => { setPending(false); setError(cause instanceof Error ? cause.message : 'No se pudo guardar la decisión.') }) }
      else reset()
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo guardar la decisión.') }
  }
  return <article className={`proposal-card ${version.status}`} style={styleAccent(proposal.style)} aria-label={`Propuesta ${style.name}`}>
    <button className="proposal-image-button" onClick={onPreview} aria-label={`Ampliar ${style.name}, versión ${version.number}`}>
      {connected && version.imageUrl ? <PrivateImage path={version.imageUrl} alt={`${proposal.label || style.name}, versión ${version.number}`} retryable={false}/> : <RoomImage style={proposal.style} />}
      {!connected && <span className="image-example">Ejemplo</span>}<span className="expand-button"><Icon name="expand" size={16} /></span>
    </button>
    <div className="proposal-body">
      <div className="proposal-title"><h3>{proposal.label || style.name}</h3><span className="version">#{proposal.position} · V{version.number}</span>
        <span className={`decision-badge ${version.status}`}><Icon name={version.status === 'accepted' ? 'check' : version.status === 'rejected' ? 'close' : 'clock'} size={12} />{version.status === 'accepted' ? 'Aceptada' : version.status === 'rejected' ? 'Rechazada' : 'Pendiente'}</span>
      </div>
      <p className="proposal-description">{version.description}</p>
      {busy || failed ? <div className={`card-progress ${failed ? 'failed' : ''}`} role="status">
        {failed ? <><span>No se completó la nueva versión.</span><button className="text-button" disabled={paused || pending} onClick={() => { const result = onAction({ type: 'retry', position: proposal.position, versionId: version.id }); if (result) void result.catch(cause => setError(cause instanceof Error ? cause.message : 'No se pudo reintentar.')) }}><Icon name="refresh" size={14} /> Reintentar</button></>
          : <><span className={paused ? '' : 'spinner'} />{paused ? 'Regeneración en pausa' : 'Preparando nueva versión…'}</>}
      </div> : <>
        <div className="decision-actions">
          <button className={`decision-button accept ${version.status === 'accepted' ? 'selected' : ''}`} onClick={() => decide('accepted')} disabled={paused || pending || version.status === 'accepted'} aria-label={`Aceptar ${style.name}`}><Icon name="check" size={16} />{pending ? 'Guardando…' : 'Aceptar'}</button>
          <button className="decision-button reject" onClick={() => { setError(''); setRejectionReason(''); setShowReason(false); setShowRejection(true) }} disabled={paused || pending} aria-label={`Rechazar ${style.name}`}><Icon name="close" size={15} />Rechazar</button>
        </div>
        <button className="reason-toggle" onClick={() => setShowReason(!showReason)} disabled={paused} aria-expanded={showReason}>
          <Icon name="plus" size={12} />{showReason ? 'Ocultar motivo' : 'Añadir motivo opcional'}
        </button>
        {showReason && <textarea className="reason-input" aria-label={`Motivo para ${style.name}`} placeholder="¿Qué te gusta o qué cambiarías?" value={reason} onChange={event => setReason(event.target.value)} maxLength={500} rows={2} disabled={paused} />}
      </>}
    </div>
    {error && !showRejection && <p className="error-message" role="alert">{error}</p>}
    {showRejection && <Dialog title={`¿Por qué rechazas ${style.name}?`} eyebrow={`PROPUESTA #${proposal.position} · V${version.number}`} onClose={() => setShowRejection(false)} busy={pending}>
      <p className="dialog-intro">Indica qué quieres cambiar. Al confirmar, se guardará el motivo y se preparará otra versión de {style.name}. Las demás propuestas se conservarán.</p>
      <form className="project-form" onSubmit={event => { event.preventDefault(); if (rejectionReason.trim() && !paused && !pending) decide('rejected') }}>
        <label>Motivo del rechazo<textarea value={rejectionReason} onChange={event => setRejectionReason(event.target.value)} placeholder="Por ejemplo: queremos conservar el techo original." rows={4} maxLength={500} required autoFocus disabled={pending}/></label>
        {error && <p className="error-message" role="alert">{error}</p>}
        <div className="confirmation-actions"><button type="button" className="button secondary" onClick={() => setShowRejection(false)} disabled={pending}>Cancelar</button><button type="submit" className="button primary" disabled={paused || pending || !rejectionReason.trim()}>{pending ? 'Guardando…' : 'Rechazar y regenerar'}</button></div>
      </form>
    </Dialog>}
  </article>
}
