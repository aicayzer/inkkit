import { describe, expect, test } from 'vitest'
import { remarkCtx } from '@milkdown/kit/core'
import { InkKitEditor } from '../src/index'
import { ListItemIndex } from '../src/source-items'
import { listItemsOf } from '../src/source-typing'
import { ctxOf } from './editor-access'

// The index finds list items without parsing the whole text each time. Whatever edits came before,
// it must find what a parse of the whole text finds, on every line that it is asked about.

function seeded(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 2 ** 32
  }
}

const lines = [
  '- a',
  '- b',
  '  - nested',
  '    - deeper',
  '1. one',
  '2) two',
  '* star',
  '-',
  '- [ ] task',
  '> - quoted',
  '> text',
  '```',
  '~~~',
  '    ~~~',
  '    code',
  '<pre>',
  '</pre>',
  '<!--',
  '-->',
  '%%',
  '---',
  '+++',
  '===',
  '# heading',
  'paragraph',
  'a | b',
  '--|--',
  '[ref]: /url',
  '',
  '',
  '',
]

const seeds = Number(process.env.ITEM_INDEX_SEEDS ?? 40)

describe('the list item index', () => {
  test('finds what a parse of the whole text finds, through edits', async () => {
    const root = document.createElement('div')
    document.body.append(root)
    const editor = await InkKitEditor.mount(root, { changed() {} }, {})
    const parse = (text: string) => ctxOf(editor).get(remarkCtx).parse(text)
    try {
      for (let seed = 1; seed <= seeds; seed++) {
        const random = seeded(seed)
        const pick = () => lines[Math.floor(random() * lines.length)]!
        let text = Array.from(
          { length: 12 + Math.floor(random() * 30) },
          pick,
        ).join('\n')
        if (seed % 7 === 0) text = '﻿' + text
        const index = new ListItemIndex(parse)
        for (let step = 0; step < 25; step++) {
          const bom = text.startsWith('﻿') ? 1 : 0
          const whole = listItemsOf(parse(text), bom)
          const asked = text.split('\n').length
          for (let attempt = 0; attempt < 3; attempt++) {
            const line = Math.floor(random() * asked)
            let start = 0
            for (let i = 0; i < line; i++) start = text.indexOf('\n', start) + 1
            const next = text.indexOf('\n', start)
            const end = next < 0 ? text.length : next
            const before =
              JSON.stringify((index as any).blocks) +
              JSON.stringify((index as any).text)
            const found = index.through(text, end, bom)
            const expected = [...whole]
              .filter((at) => at <= end)
              .sort((a, b) => a - b)
            const got = [...found]
              .filter((at) => at <= end)
              .sort((a, b) => a - b)
            expect(
              got,
              `seed ${seed} step ${step} line ${line} end ${end} text ${JSON.stringify(text)}`,
            ).toEqual(expected)
          }
          // An edit: a line changed, inserted or removed, or a character typed.
          const all = text.split('\n')
          const at = Math.floor(random() * all.length)
          const kind = random()
          if (kind < 0.3) all[at] = pick()
          else if (kind < 0.55) all.splice(at, 0, pick())
          else if (kind < 0.7 && all.length > 3) all.splice(at, 1)
          else all[at] = all[at]! + (random() < 0.5 ? ' x' : '')
          text = all.join('\n')
          if (bom && !text.startsWith('﻿')) text = '﻿' + text
        }
      }
    } finally {
      await editor.destroy()
      root.remove()
    }
  })

  test('parses only what changed after the first call', async () => {
    const root = document.createElement('div')
    document.body.append(root)
    const editor = await InkKitEditor.mount(root, { changed() {} }, {})
    let parsed = 0
    const parse = (text: string) => {
      parsed += text.length
      return ctxOf(editor).get(remarkCtx).parse(text)
    }
    try {
      const blocks = Array.from(
        { length: 2000 },
        (_, i) => `Paragraph ${i} alpha.`,
      )
      const text =
        blocks.slice(0, 1000).join('\n\n') +
        '\n\n- a\n- b' +
        '\n\n' +
        blocks.slice(1000).join('\n\n')
      const index = new ListItemIndex(parse)
      const end = text.indexOf('- b') + 3
      index.through(text, end, 0)
      const first = parsed
      // Up to the line asked about, and the line after it.
      expect(first).toBeLessThanOrEqual(end + 30)
      parsed = 0
      const edited = text.slice(0, end) + '\n- ' + text.slice(end)
      const again = index.through(edited, end + 3, 0)
      expect(again.has(text.indexOf('- b'))).toBe(true)
      // The list, not the note before it.
      expect(parsed).toBeLessThan(40)
    } finally {
      await editor.destroy()
      root.remove()
    }
  })
})
