import { createContext, useContext, useEffect, useState } from 'react'
import { Icon } from './components.tsx'

export type ImageLoader = (path:string, signal?:AbortSignal) => Promise<Blob>
export const ImageContext = createContext<ImageLoader | null>(null)
export function PrivateImage({ path, alt, className='', retryable=true }: {path:string;alt:string;className?:string;retryable?:boolean}) {
  const load = useContext(ImageContext)
  const [url,setUrl] = useState('')
  const [error,setError] = useState('')
  const [attempt,setAttempt] = useState(0)
  useEffect(() => {
    const abort = new AbortController()
    let objectUrl = ''
    setUrl(''); setError('')
    if (!load) { setError('No se pudo autorizar la imagen.'); return }
    void load(path,abort.signal).then(blob => {
      if (abort.signal.aborted) return
      objectUrl = URL.createObjectURL(blob)
      setUrl(objectUrl)
    }).catch(cause => { if (!abort.signal.aborted) setError(cause instanceof Error ? cause.message : 'No se pudo cargar la imagen.') })
    return () => { abort.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl) }
  },[path,load,attempt])
  if (error) return <span className={`private-image-state ${className}`} role="status"><Icon name="info" size={17}/><span>{error}</span>{retryable && <button type="button" className="text-button" onClick={()=>setAttempt(value=>value+1)}>Reintentar imagen</button>}</span>
  if (!url) return <span className={`private-image-state ${className}`} role="status"><span className="spinner"/><span>Cargando imagen…</span></span>
  return <img className={`photo-image ${className}`} src={url} alt={alt}/>
}
