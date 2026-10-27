import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { generate, totalUsage, loadMessages } from './chat.js'

const reply = {
  response: 'Texto generado por Qwen...', model: 'Qwen/Qwen3.5-4B',
  usage: { input_tokens: 24, output_tokens: 64, total_tokens: 88 },
  generation_seconds: 9.558,
}

test('envía el contrato de generate y conserva respuesta, modelo, uso y tiempo', async () => {
  const server = createServer(async (req, res) => {
    let body = ''
    for await (const chunk of req) body += chunk
    assert.equal(req.method, 'POST')
    assert.equal(req.url, '/generate')
    assert.equal(req.headers['content-type'], 'application/json')
    assert.deepEqual(JSON.parse(body), { prompt: 'Hola', max_new_tokens: 128 })
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify(reply))
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    assert.deepEqual(await generate('Hola', 128, `http://127.0.0.1:${server.address().port}/generate`), reply)
  } finally { await new Promise(resolve => server.close(resolve)) }
})

test('acumula únicamente los tokens de las respuestas completadas', () => {
  assert.deepEqual(totalUsage([
    { role: 'user', content: 'Hola' },
    { role: 'assistant', content: 'Uno', ...reply },
    { role: 'assistant', content: 'Dos', usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 } },
  ]), { input_tokens: 34, output_tokens: 69, total_tokens: 103 })
  assert.deepEqual(totalUsage([]), { input_tokens: 0, output_tokens: 0, total_tokens: 0 })
})

test('recupera historial de sesión y tolera almacenamiento corrupto o bloqueado', () => {
  const messages = [{ role: 'user', content: 'Hola' }, { role: 'assistant', content: reply.response, ...reply }]
  assert.deepEqual(loadMessages({ getItem: () => JSON.stringify(messages) }), messages)
  for (const raw of ['{', '{}', '[null]', '[{"role":"otro","content":1}]']) {
    assert.deepEqual(loadMessages({ getItem: () => raw }), [])
  }
  assert.deepEqual(loadMessages({ getItem: () => { throw new Error('bloqueado') } }), [])
})

test('rechaza errores HTTP y respuestas inválidas sin inventar tokens', async () => {
  const original = globalThis.fetch
  try {
    globalThis.fetch = async () => new Response('falló', { status: 503 })
    await assert.rejects(generate('Hola', 128), /503/)
    for (const invalid of [{ response: 'Hola' }, { ...reply, usage: { input_tokens: -1, output_tokens: 2, total_tokens: 1 } }]) {
      globalThis.fetch = async () => Response.json(invalid)
      await assert.rejects(generate('Hola', 128), /inválida/)
    }
  } finally { globalThis.fetch = original }
})
