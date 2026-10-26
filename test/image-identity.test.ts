import { expect, test } from 'vitest'
import { distinctImages } from '../src/image-identity'
import type { CapturedImage } from '../src/types'

const u32 = (value: number) => [
  (value >>> 24) & 255,
  (value >>> 16) & 255,
  (value >>> 8) & 255,
  value & 255,
]
function png(width: number, height: number, seed = 0): Uint8Array {
  return new Uint8Array([
    0x89,
    0x50,
    0x4e,
    0x47,
    0x0d,
    0x0a,
    0x1a,
    0x0a,
    ...u32(13),
    0x49,
    0x48,
    0x44,
    0x52,
    ...u32(width),
    ...u32(height),
    8,
    6,
    0,
    0,
    0,
    seed,
  ])
}
function tiff(
  width: number,
  height: number,
  options: { big?: boolean; type?: number; seed?: number } = {},
): Uint8Array {
  const big = options.big ?? false
  const type = options.type ?? 3
  const short = (value: number) =>
    big ? [value >> 8, value & 255] : [value & 255, value >> 8]
  const long = (value: number) => (big ? u32(value) : u32(value).reverse())
  const entry = (tag: number, value: number) => [
    ...short(tag),
    ...short(type),
    ...long(1),
    ...(type === 3 ? [...short(value), 0, 0] : long(value)),
  ]
  return new Uint8Array([
    ...(big ? [0x4d, 0x4d, 0, 0x2a] : [0x49, 0x49, 0x2a, 0]),
    ...long(8),
    ...short(2),
    ...entry(256, width),
    ...entry(257, height),
    ...long(0),
    options.seed ?? 0,
  ])
}
const image = (
  bytes: Uint8Array,
  mimeType: string,
  filename?: string,
  source?: string,
): CapturedImage => ({ bytes, mimeType, filename, source })

test('identical bytes are one picture whatever the names and types say', () => {
  const kept = distinctImages([
    image(png(4, 4), 'image/png', 'a.png'),
    image(png(4, 4), 'image/x-png', 'b.png'),
    image(new Uint8Array([1, 2, 3]), 'image/jpeg'),
    image(new Uint8Array([1, 2, 3]), 'image/jpeg'),
  ])
  expect(kept.map((entry) => entry.filename)).toEqual(['a.png', undefined])
})

test('a PNG and a TIFF of one size and name stem are one picture, in either byte order', () => {
  for (const big of [false, true]) {
    for (const type of [3, 4]) {
      const kept = distinctImages([
        image(tiff(1200, 800, { big, type }), 'image/tiff', 'Shot.TIFF'),
        image(png(1200, 800), 'image/png', 'shot.png'),
      ])
      expect(kept).toHaveLength(1)
      expect(kept[0]?.mimeType).toBe('image/png')
    }
  }
  const unnamed = distinctImages([
    image(png(5, 5), 'image/png'),
    image(tiff(5, 5), 'image/tiff', 'Screenshot.tiff'),
  ])
  expect(unnamed).toHaveLength(1)
  expect(unnamed[0]?.mimeType).toBe('image/png')
})

test('different pictures stay separate', () => {
  expect(
    distinctImages([
      image(png(4, 4, 1), 'image/png', 'a.png'),
      image(png(4, 4, 2), 'image/png', 'a.png'),
    ]),
  ).toHaveLength(2)
  expect(
    distinctImages([
      image(png(4, 4), 'image/png', 'a.png'),
      image(tiff(4, 5), 'image/tiff', 'a.tiff'),
    ]),
  ).toHaveLength(2)
  expect(
    distinctImages([
      image(png(4, 4), 'image/png', 'a.png'),
      image(tiff(4, 4), 'image/tiff', 'b.tiff'),
    ]),
  ).toHaveLength(2)
  expect(
    distinctImages([
      image(png(4, 4), 'image/png', 'a.png'),
      image(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), 'image/jpeg', 'a.jpg'),
    ]),
  ).toHaveLength(2)
})

test('images bound to different HTML images are never merged', () => {
  const bytes = png(4, 4)
  expect(
    distinctImages([
      image(bytes, 'image/png', 'a.png', 'one'),
      image(bytes, 'image/png', 'a.png', 'two'),
    ]),
  ).toHaveLength(2)
  expect(
    distinctImages([
      image(bytes, 'image/png', 'a.png', 'one'),
      image(bytes, 'image/png', 'a.png', 'one'),
    ]),
  ).toHaveLength(1)
})

test('truncated and malformed headers are never matched', () => {
  const real = png(4, 4)
  const cases = [
    new Uint8Array(),
    real.slice(0, 20),
    new Uint8Array([0x49, 0x49, 0x2a, 0, 0xff, 0xff, 0xff, 0x7f]),
    tiff(4, 4).slice(0, 20),
    tiff(0, 0),
  ]
  for (const bytes of cases)
    expect(
      distinctImages([
        image(real, 'image/png', 'a.png'),
        image(bytes, 'image/tiff', 'a.tiff'),
      ]),
    ).toHaveLength(2)
})
