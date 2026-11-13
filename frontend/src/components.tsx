import { useEffect, useRef, useState, type ReactNode, type CSSProperties } from 'react'
import { STYLES, type Style, type Photo } from './domain.ts'

const paths = {
  bed: 'M3 18v-7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v7M3 15h18M3 19v2m18-2v2M5 9V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v4M7 9V6h4v3m2 0V6h4v3',
  folder: 'M3 19V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2ZM3 9h18',
  plus: 'M12 5v14M5 12h14', search: 'M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
  check: 'm5 12 4 4L19 6', close: 'm6 6 12 12M6 18 18 6',
  clock: 'M12 8v4l3 2M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0',
  sparkle: 'm12 2 3 7 7 3-7 3-3 7-3-7-7-3 7-3 3-7Z',
  arrow: 'M12 19V5m-6 6 6-6 6 6', attach: 'm8 12 6-6a3 3 0 0 1 4 4l-8 8a5 5 0 0 1-7-7l9-9',
  upload: 'M12 16V3m-5 5 5-5 5 5M3 15v4a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-4',
  pause: 'M8 5v14M16 5v14', play: 'm8 4 12 8-12 8V4Z',
  trash: 'M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7',
  chevron: 'm9 5 7 7-7 7', menu: 'M4 6h16M4 12h16M4 18h16',
  expand: 'M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5',
  copy: 'M9 9h12v12H9V9ZM15 9V3H3v12h6',
  info: 'M12 11v6m0-10v.01M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0',
  refresh: 'M21 3v6h-6M3 21v-6h6M21 9a9 9 0 0 0-15-5M3 15a9 9 0 0 0 15 5',
} as const
export function Icon({ name, size = 18, className = '' }: { name: keyof typeof paths; size?: number; className?: string }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.55" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true"><path d={paths[name]} /></svg>
}

export function RoomImage({ style, className = '' }: { style: Style; className?: string }) {
  return <svg className={`room-image ${className}`} viewBox={STYLES[style].crop} role="img" aria-label={`Dormitorio de ejemplo: estilo ${STYLES[style].name}`} preserveAspectRatio="xMidYMid slice">
    <image href="/demo/bedrooms.png" width="1476" height="1065" />
  </svg>
}

export function PhotoImage({ photo, className = '' }: { photo: Photo; className?: string }) {
  const [url, setUrl] = useState('')
  useEffect(() => {
    if (photo.kind !== 'upload') return
    const next = URL.createObjectURL(photo.blob)
    setUrl(next)
    return () => URL.revokeObjectURL(next)
  }, [photo])
  if (photo.kind === 'example') return <RoomImage style="japanese" className={className} />
  return <img className={`photo-image ${className}`} src={url || undefined} alt={`Fotografía original: ${photo.name}`} />
}

export function Dialog({ title, eyebrow, children, onClose, wide = false, drawer = false }: { title: string; eyebrow?: string; children: ReactNode; onClose: () => void; wide?: boolean; drawer?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const dialog = ref.current!
    dialog.showModal()
    const scroll = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { dialog.close(); document.body.style.overflow = scroll; previous?.focus() }
  }, [])
  return <dialog ref={ref} className={`dialog ${wide ? 'wide-dialog' : ''} ${drawer ? 'drawer-dialog' : ''}`} aria-labelledby="dialog-title"
    onCancel={onClose} onClick={event => { if (event.target === event.currentTarget) onClose() }}>
    <div className="dialog-surface">
      <header className="dialog-heading"><div>{eyebrow && <p className="eyebrow">{eyebrow}</p>}<h2 id="dialog-title">{title}</h2></div>
        <button className="icon-button" aria-label="Cerrar ventana" onClick={onClose}><Icon name="close" /></button>
      </header>
      {children}
    </div>
  </dialog>
}

export function Mark({ small = false }: { small?: boolean }) {
  return <span className={`assistant-mark ${small ? 'small' : ''}`}><Icon name="sparkle" size={small ? 15 : 22} /></span>
}

export const styleAccent = (style: Style): CSSProperties => ({ '--style-accent': STYLES[style].accent }) as CSSProperties
