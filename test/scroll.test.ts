import { expect, test } from 'vitest'
import { scrollWholePixels } from '../src/scroll'

// Stores positions as whole pixels, rounding to the nearest, as engines with
// integer scroll offsets do.
function wholePixelElement(top: number, left = 0, maxTop = 1000) {
  let y = top,
    x = left
  return {
    scrollHeight: maxTop + 640,
    clientHeight: 640,
    get scrollTop() {
      return y
    },
    set scrollTop(value: number) {
      y = Math.min(maxTop, Math.max(0, Math.round(value)))
    },
    get scrollLeft() {
      return x
    },
    set scrollLeft(value: number) {
      x = Math.min(1000, Math.max(0, Math.round(value)))
    },
  } as unknown as HTMLElement
}

test('a fraction of a pixel below the viewport still scrolls a whole pixel', () => {
  const element = wholePixelElement(14735, 0, 20000)
  expect(scrollWholePixels(element, 0.083, 0)).toEqual({
    vertical: 0,
    horizontal: 0,
  })
  expect(element.scrollTop).toBe(14736)
})

test('a fraction above or beside the viewport scrolls a whole pixel the other way', () => {
  const element = wholePixelElement(500, 40)
  expect(scrollWholePixels(element, -0.4, -0.2)).toEqual({
    vertical: 0,
    horizontal: 0,
  })
  expect([element.scrollTop, element.scrollLeft]).toEqual([499, 39])
})

test('whole and larger distances move exactly and report nothing left', () => {
  const element = wholePixelElement(100)
  expect(scrollWholePixels(element, 25, 0).vertical).toBe(0)
  expect(element.scrollTop).toBe(125)
  expect(scrollWholePixels(element, -2.3, 0).vertical).toBe(0)
  expect(element.scrollTop).toBe(122)
})

test('distance the element cannot scroll is returned for its parents', () => {
  const element = wholePixelElement(995, 0, 1000)
  expect(scrollWholePixels(element, 30.5, 0).vertical).toBe(25.5)
  expect(element.scrollTop).toBe(1000)
  const start = wholePixelElement(0)
  expect(scrollWholePixels(start, -12, 0).vertical).toBe(-12)
})

test('no distance leaves the position alone', () => {
  const element = wholePixelElement(7, 3)
  expect(scrollWholePixels(element, 0, 0)).toEqual({
    vertical: 0,
    horizontal: 0,
  })
  expect([element.scrollTop, element.scrollLeft]).toEqual([7, 3])
})

test('a reveal that stops within the padding of the first or last line shows the padding', () => {
  const padding = { top: 12, bottom: 12 }
  const up = wholePixelElement(400, 0, 20000)
  expect(scrollWholePixels(up, -388.2, 0, padding).vertical).toBe(0)
  expect(up.scrollTop).toBe(0)
  const near = wholePixelElement(400, 0, 20000)
  scrollWholePixels(near, -300, 0, padding)
  expect(near.scrollTop).toBe(100)
  const down = wholePixelElement(19000, 0, 20000)
  expect(scrollWholePixels(down, 990.4, 0, padding).vertical).toBe(0)
  expect(down.scrollTop).toBe(20000)
})
