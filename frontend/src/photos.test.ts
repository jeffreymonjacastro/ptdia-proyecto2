import test from 'node:test'
import assert from 'node:assert/strict'
import { inspectPhoto } from './photos.ts'

test('se rechaza un archivo renombrado como imagen y un SVG', async () => {
  await assert.rejects(inspectPhoto(new File(['no es una imagen'], 'foto.png', { type: 'image/png' })), /imagen/)
  await assert.rejects(inspectPhoto(new File(['<svg></svg>'], 'foto.svg', { type: 'image/svg+xml' })), /JPG, PNG o WebP/)
})

test('un archivo mayor a 10 MiB se rechaza antes de intentar decodificarlo', async () => {
  await assert.rejects(inspectPhoto(new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'foto.jpg', { type: 'image/jpeg' })), /10 MB/)
})

test('una cabecera PNG válida supera la inspección inicial', async () => {
  await assert.doesNotReject(inspectPhoto(new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], 'foto.png', { type: 'image/png' })))
})
