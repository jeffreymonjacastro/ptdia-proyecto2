import type { Photo } from './domain.ts'

export async function inspectPhoto(file: File): Promise<void> {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('Usa una fotografía JPG, PNG o WebP.')
  if (file.size > 10 * 1024 * 1024) throw new Error('La fotografía supera el límite de 10 MB.')
  const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer())
  const starts = (values: number[], offset = 0) => values.every((value, index) => bytes[offset + index] === value)
  const valid = file.type === 'image/jpeg' ? starts([255, 216, 255])
    : file.type === 'image/png' ? starts([137, 80, 78, 71, 13, 10, 26, 10])
    : starts([82, 73, 70, 70]) && starts([87, 69, 66, 80], 8)
  if (!valid) throw new Error('El archivo no contiene una imagen válida. Prueba con otra fotografía.')
}

export async function readPhoto(file: File): Promise<Photo> {
  await inspectPhoto(file)
  let bitmap: ImageBitmap
  try { bitmap = await createImageBitmap(file) }
  catch { throw new Error('No se pudo abrir la fotografía. El archivo puede estar dañado.') }
  const { width, height } = bitmap
  bitmap.close()
  if (!width || !height || width * height > 25_000_000) throw new Error('Usa una fotografía de hasta 25 megapíxeles.')
  return { kind: 'upload', name: file.name, blob: file, width, height }
}
