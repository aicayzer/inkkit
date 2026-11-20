import { expect, test, vi } from 'vitest'
import { textPieces } from '../src/drawn-selection'

function document(blocks: number): { root: HTMLElement; texts: Text[] } {
  const root = window.document.createElement('div')
  const texts: Text[] = []
  for (let i = 0; i < blocks; i++) {
    const block = window.document.createElement(i % 10 === 0 ? 'h2' : 'p')
    // A block with a control has a child before its text, as a heading with a fold button does.
    if (i % 10 === 0) block.append(window.document.createElement('span'))
    const text = window.document.createTextNode(`Block ${i}`)
    block.append(text)
    texts.push(text)
    root.append(block)
  }
  window.document.body.append(root)
  return { root, texts }
}

test('a range reads only the text it covers, wherever it starts in the document', () => {
  const { root, texts } = document(400)
  const range = window.document.createRange()
  range.setStart(texts[300]!, 2)
  range.setEnd(texts[305]!, 4)
  const spy = vi.spyOn(Range.prototype, 'intersectsNode')
  const pieces = [...textPieces(range)].map((piece) => piece.toString())
  expect(pieces).toEqual([
    'ock 300',
    'Block 301',
    'Block 302',
    'Block 303',
    'Block 304',
    'Bloc',
  ])
  // The walk does not pass the 300 text nodes before the range.
  expect(spy.mock.calls.length).toBeLessThanOrEqual(pieces.length + 1)
  spy.mockRestore()
  root.remove()
})

test('a range that starts at an element covers the text from that element', () => {
  const { root, texts } = document(30)
  const range = window.document.createRange()
  // After the control in the first heading, the way a heading's painted range starts.
  range.setStart(root.children[10]!, 1)
  range.setEnd(texts[12]!, 3)
  expect([...textPieces(range)].map((piece) => piece.toString())).toEqual([
    'Block 10',
    'Block 11',
    'Blo',
  ])
  root.remove()
})

test('a range inside one text node yields itself', () => {
  const { root, texts } = document(3)
  const range = window.document.createRange()
  range.setStart(texts[1]!, 1)
  range.setEnd(texts[1]!, 4)
  expect([...textPieces(range)].map((piece) => piece.toString())).toEqual([
    'loc',
  ])
  root.remove()
})
