import type { CapturedImage } from './types'

type Format = 'png' | 'tiff'

const pngSignature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

function format(bytes: Uint8Array): Format | undefined {
  if (
    bytes.length >= 8 &&
    pngSignature.every((value, index) => bytes[index] === value)
  )
    return 'png'
  if (
    bytes.length >= 8 &&
    ((bytes[0] === 0x49 &&
      bytes[1] === 0x49 &&
      bytes[2] === 0x2a &&
      bytes[3] === 0) ||
      (bytes[0] === 0x4d &&
        bytes[1] === 0x4d &&
        bytes[2] === 0 &&
        bytes[3] === 0x2a))
  )
    return 'tiff'
  return undefined
}

/** The pixel size in the header of a PNG or the first image of a TIFF. Nothing is decoded, so a
 *  truncated or unusual file gives `undefined` and is never treated as a match. */
function size(
  bytes: Uint8Array,
  kind: Format,
): { width: number; height: number } | undefined {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (kind === 'png') {
    if (bytes.length < 24 || view.getUint32(12) !== 0x49484452) return undefined
    return { width: view.getUint32(16), height: view.getUint32(20) }
  }
  const little = bytes[0] === 0x49
  const directory = view.getUint32(4, little)
  if (directory + 2 > bytes.length) return undefined
  const entries = view.getUint16(directory, little)
  let width: number | undefined
  let height: number | undefined
  for (let index = 0; index < entries; index++) {
    const entry = directory + 2 + index * 12
    if (entry + 12 > bytes.length) return undefined
    const tag = view.getUint16(entry, little)
    if (tag !== 256 && tag !== 257) continue
    const type = view.getUint16(entry + 2, little)
    const value =
      type === 3
        ? view.getUint16(entry + 8, little)
        : type === 4
          ? view.getUint32(entry + 8, little)
          : undefined
    if (tag === 256) width = value
    else height = value
  }
  return width && height ? { width, height } : undefined
}

function identical(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  for (let index = 0; index < a.length; index++)
    if (a[index] !== b[index]) return false
  return true
}

function stem(filename: string | undefined): string {
  const name = (filename ?? '').split(/[\\/]/).pop() ?? ''
  const dot = name.lastIndexOf('.')
  return (dot > 0 ? name.slice(0, dot) : name).normalize('NFC').toLowerCase()
}

/** Whether two captured images are one picture in two representations. */
function sameImage(a: CapturedImage, b: CapturedImage): boolean {
  // An image bound to an HTML image stays with that image.
  if ((a.source ?? '') !== (b.source ?? '')) return false
  if (identical(a.bytes, b.bytes)) return true
  const kindA = format(a.bytes)
  const kindB = format(b.bytes)
  if (!kindA || !kindB || kindA === kindB) return false
  const nameA = stem(a.filename)
  const nameB = stem(b.filename)
  if (nameA && nameB && nameA !== nameB) return false
  const sizeA = size(a.bytes, kindA)
  const sizeB = size(b.bytes, kindB)
  return (
    !!sizeA &&
    !!sizeB &&
    sizeA.width === sizeB.width &&
    sizeA.height === sizeB.height
  )
}

/** Keeps one image for each picture in a single paste or drop. A clipboard can hold a picture
 *  more than once, such as a screenshot as PNG and as TIFF, and each copy would be stored and
 *  inserted separately.
 *
 *  Two images are one picture when their bytes are identical, or when one is a PNG and the other a
 *  TIFF with the same pixel size and compatible names (the same name without its extension, or a
 *  name missing). Anything else is a different image, including a copy that was resized, re-encoded
 *  as JPEG or renamed. The first image keeps its place; a PNG replaces a TIFF of the same picture
 *  because every web view can show it. */
export function distinctImages(
  images: readonly CapturedImage[],
): CapturedImage[] {
  const kept: CapturedImage[] = []
  for (const image of images) {
    const index = kept.findIndex((other) => sameImage(other, image))
    if (index < 0) kept.push(image)
    else if (
      format(kept[index]!.bytes) === 'tiff' &&
      format(image.bytes) === 'png'
    )
      kept[index] = image
  }
  return kept
}
