export const SESSION_KEY = 'qwen-chat-session'

function validUsage(usage) {
  return usage && ['input_tokens', 'output_tokens', 'total_tokens']
    .every(key => Number.isSafeInteger(usage[key]) && usage[key] >= 0)
}

export async function generate(prompt, maxNewTokens, endpoint = '/generate') {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, max_new_tokens: maxNewTokens }),
  })
  if (!response.ok) throw new Error(`El backend devolvió un error HTTP ${response.status}.`)
  const data = await response.json()
  if (typeof data?.response !== 'string' || typeof data.model !== 'string' ||
      !validUsage(data.usage) || !Number.isFinite(data.generation_seconds) || data.generation_seconds < 0) {
    throw new Error('El backend devolvió una respuesta inválida.')
  }
  return data
}

export function totalUsage(messages) {
  return messages.reduce((total, message) => {
    if (message.role === 'assistant' && validUsage(message.usage)) {
      for (const key of Object.keys(total)) total[key] += message.usage[key]
    }
    return total
  }, { input_tokens: 0, output_tokens: 0, total_tokens: 0 })
}

export function loadMessages(storage) {
  try {
    const messages = JSON.parse((storage ?? globalThis.sessionStorage).getItem(SESSION_KEY) ?? '[]')
    return Array.isArray(messages) && messages.every(message => message &&
      ['user', 'assistant'].includes(message.role) && typeof message.content === 'string' &&
      (message.role !== 'assistant' || (validUsage(message.usage) &&
        typeof message.model === 'string' && Number.isFinite(message.generation_seconds)))) ? messages : []
  } catch { return [] }
}
