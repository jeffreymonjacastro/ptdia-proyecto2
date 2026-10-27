import { StrictMode, useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { generate, loadMessages, SESSION_KEY, totalUsage } from './chat.js'
import './style.css'

function App() {
  const [messages, setMessages] = useState(() => loadMessages())
  const [prompt, setPrompt] = useState('')
  const [maxTokens, setMaxTokens] = useState('128')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [storageError, setStorageError] = useState(false)
  const busy = useRef(false)
  const end = useRef(null)
  const input = useRef(null)
  const usage = totalUsage(messages)
  const replies = messages.filter(message => message.role === 'assistant')
  const lastReply = replies.at(-1)
  const validLimit = Number.isSafeInteger(Number(maxTokens)) && Number(maxTokens) > 0

  useEffect(() => {
    try {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(messages))
      setStorageError(false)
    } catch { setStorageError(true) }
  }, [messages])

  useEffect(() => { end.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages, loading])

  async function send(event) {
    event.preventDefault()
    const text = prompt.trim()
    if (!text || busy.current || !validLimit) return
    busy.current = true
    setLoading(true)
    setError('')
    setPrompt('')
    setMessages(previous => [...previous, { role: 'user', content: text }])
    try {
      const data = await generate(text, Number(maxTokens))
      setMessages(previous => [...previous, {
        role: 'assistant', content: data.response, model: data.model,
        usage: data.usage, generation_seconds: data.generation_seconds,
      }])
    } catch (cause) {
      setError(cause instanceof TypeError
        ? 'No se pudo conectar. Comprueba que el backend de ngrok esté disponible.'
        : cause.message)
      setPrompt(text)
    } finally {
      busy.current = false
      setLoading(false)
      input.current?.focus()
    }
  }

  function clearSession() {
    setMessages([])
    setPrompt('')
    setError('')
    input.current?.focus()
  }

  return (
    <div className="app">
      <header className="header">
        <a className="brand" href="./" aria-label="Qwen, inicio"><span className="brand-mark">✳</span> qwen<span className="local-badge">LOCAL</span></a>
        <button className="new-chat" onClick={clearSession} disabled={loading}>＋ <span>Limpiar sesión</span></button>
      </header>

      <main className={messages.length ? 'conversation' : 'conversation empty'}>
        {messages.length === 0 ? (
          <div className="welcome">
            <div className="welcome-mark" aria-hidden="true">✳</div>
            <p className="eyebrow">TU ESPACIO PARA EXPLORAR</p>
            <h1>¿Qué tienes en mente?</h1>
            <p>Una pregunta, una idea, un nuevo comienzo.<br />Conversa con tu modelo local.</p>
          </div>
        ) : (
          <div className="messages" role="log" aria-label="Historial de mensajes" aria-live="polite">
            {messages.map((message, index) => (
              <article className={`message ${message.role}`} key={index}>
                <div className="message-label">{message.role === 'user' ? 'Tú' : <><span className="small-mark">✳</span> Qwen</>}</div>
                <div className="message-content">{message.content}</div>
                {message.usage && <div className="message-meta">
                  {message.model} · {message.usage.input_tokens} entrada · {message.usage.output_tokens} salida · {message.usage.total_tokens} tokens · {message.generation_seconds.toFixed(2)} s
                </div>}
              </article>
            ))}
            {loading && <div className="thinking" role="status"><span className="small-mark">✳</span> Generando respuesta<span className="dots">…</span></div>}
            <div ref={end} />
          </div>
        )}
      </main>

      <footer className="composer-area">
        {error && <p className="error" role="alert">{error}</p>}
        {storageError && <p className="error" role="alert">No se pudo guardar la sesión. El historial solo se conservará hasta recargar.</p>}
        <form className="composer" onSubmit={send}>
          <label className="sr-only" htmlFor="prompt">Mensaje</label>
          <textarea id="prompt" ref={input} value={prompt} onChange={event => setPrompt(event.target.value)}
            placeholder="Escribe un mensaje…" rows={3} disabled={loading}
            onKeyDown={event => {
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault()
                event.currentTarget.form.requestSubmit()
              }
            }} />
          <div className="composer-tools">
            <span className="model"><span className="model-dot" />{lastReply?.model ?? 'Modelo local'}</span>
            <div className="send-tools">
              <label className="token-limit" htmlFor="max-tokens">Máx. tokens <input id="max-tokens" type="number" min="1" step="1" required value={maxTokens} onChange={event => setMaxTokens(event.target.value)} disabled={loading} /></label>
              <button className="send" type="submit" disabled={loading || !prompt.trim() || !validLimit} aria-label="Enviar mensaje">↑</button>
            </div>
          </div>
        </form>
        <div className="session-stats" aria-label="Tokens de la sesión">
          <span>SESIÓN ACTUAL</span>
          <span><strong>{usage.input_tokens}</strong> entrada</span>
          <span><strong>{usage.output_tokens}</strong> salida</span>
          <span><strong>{usage.total_tokens}</strong> tokens totales</span>
          <span className="response-count">{replies.length} respuestas</span>
        </div>
        <p className="footnote">Enter para enviar · Shift + Enter para una nueva línea · Historial guardado en esta pestaña</p>
      </footer>
    </div>
  )
}

createRoot(document.getElementById('root')).render(<StrictMode><App /></StrictMode>)
