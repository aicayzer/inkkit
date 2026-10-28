const portableImageMIMEs = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/avif',
  'image/bmp',
  'image/tiff',
])

export function isPortableImageMIME(mimeType: string): boolean {
  return portableImageMIMEs.has(mimeType)
}

export function bytesToDataURL(bytes: Uint8Array, mimeType: string): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return `data:${mimeType};base64,${btoa(binary)}`
}
