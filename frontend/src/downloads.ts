import { zipSync } from 'fflate'
import { currentVersion, type Project, type Style } from './domain.ts'

export function approvedVersions(project: Project) {
  const summary = project.summary
  if (!summary || summary.revision !== project.revision || !['ready', 'completed', 'paused'].includes(project.status) || project.proposals.length !== 5) return []
  const ids = new Set(summary.acceptedVersionIds)
  if (summary.acceptedVersionIds.length !== 5 || ids.size !== 5) return []
  const rows = [...project.proposals].sort((a, b) => a.position - b.position).map(proposal => ({ proposal, version: currentVersion(proposal) }))
  if (new Set(rows.map(row => row.proposal.position)).size !== 5 || new Set(rows.map(row => row.proposal.style)).size !== 5) return []
  if (rows.some(({ proposal, version }) => !version || proposal.generation !== 'idle' || version.status !== 'accepted' || !ids.has(version.id))) return []
  if (new Set(rows.map(row => row.version.id)).size !== 5) return []
  return rows
}

export function imageFilename(style: Style, number: number, mime: string) {
  const extension = ({ 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' } as Record<string, string>)[mime.split(';')[0].trim().toLowerCase()]
  if (!extension) throw new Error('El servidor no devolvió una imagen PNG, JPEG o WebP.')
  return `${style}-v${number}.${extension}`
}

export async function buildImageZip(images: { filename: string; blob: Blob }[]): Promise<Blob> {
  const files = Object.fromEntries(await Promise.all(images.map(async image => [image.filename, new Uint8Array(await image.blob.arrayBuffer())] as const)))
  // Generated images are already compressed; ZIP stores the original bytes.
  const bytes = zipSync(files, { level: 0 })
  return new Blob([new Uint8Array(bytes).buffer], { type: 'application/zip' })
}

export function saveDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.append(link)
  try { link.click() }
  finally {
    link.remove()
    // Give the browser time to start the download before releasing its URL.
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
}
