import { afterAll, describe, expect, test } from 'vitest'
import { editorViewCtx, parserCtx } from '@milkdown/kit/core'
import { Fragment, type Node as ProseNode } from '@milkdown/kit/prose/model'
import { TextSelection } from '@milkdown/kit/prose/state'
import { ctxOf, facadeFixture, withFacade } from './editor-access'
import { expectFacadeSave } from './facade-preservation'
import { localEditsOf, withoutFastPaths } from './preservation-access'
import { Preservation, crossCheck, preservationWork } from '../src/preserve'

test('Enter, typing and Backspace in a long task list keep validation bounded and save exact bytes', async () => {
  const source =
    Array.from(
      { length: 5000 },
      (_, index) => `+ [ ] Item ${index} café 😀 __kept__.`,
    ).join('\r\n') + '\r\n'
  const checking = crossCheck.enabled
  crossCheck.enabled = false
  try {
    await withFacade(source, (editor) => {
      const view = ctxOf(editor).get(editorViewCtx)
      let position = -1
      view.state.doc.descendants((node, pos) => {
        if (node.isTextblock && node.textContent.startsWith('Item 2500 '))
          position = pos + 1 + node.content.size
      })
      expect(position).toBeGreaterThan(0)
      view.dispatch(
        view.state.tr.setSelection(
          TextSelection.create(view.state.doc, position),
        ),
      )
      const action = (run: () => boolean) => {
        const before = preservationWork.characters
        expect(run()).toBe(true)
        expect(preservationWork.characters - before).toBeLessThan(10_000)
      }
      action(() => editor.keyDown({ key: 'Enter' }, 1))
      action(() => editor.insertText('Added 雪', 1))
      const split = source.replace(
        '+ [ ] Item 2500 café 😀 __kept__.',
        '+ [ ] Item 2500 café 😀 __kept__.\r\n+ [ ] Added 雪',
      )
      expect(editor.snapshot().text).toBe(split)
      const at = view.state.selection.from - 'Added 雪'.length
      view.dispatch(
        view.state.tr.setSelection(TextSelection.create(view.state.doc, at)),
      )
      action(() => editor.keyDown({ key: 'Backspace' }, 1))
      action(() => editor.keyDown({ key: 'Backspace' }, 1))
      // The joined text follows the existing strong-marked word without
      // changing its authored delimiters or any neighbouring task marker.
      const joined = source.replace(
        '+ [ ] Item 2500 café 😀 __kept__.',
        '+ [ ] Item 2500 café 😀 __kept__.Added 雪',
      )
      expect(editor.snapshot().text).toBe(joined)
      let undos = 0
      while (editor.snapshot().dirty && undos++ < 10)
        expect(editor.undo()).toBe(true)
      expect(editor.snapshot().text).toBe(source)
      for (let step = 0; step < undos; step++) expect(editor.redo()).toBe(true)
      expect(editor.snapshot().text).toBe(joined)
      editor.loadDocument({
        documentId: 'reopened',
        generation: 2,
        format: 'md',
        text: joined,
      })
      expect(editor.snapshot().text).toBe(joined)
    })
  } finally {
    crossCheck.enabled = checking
  }
}, 60_000)

test('typing far from an inserted item validates separate runs with whole-writer matching', async () => {
  const source =
    Array.from(
      { length: 1000 },
      (_, index) => `* [ ] Item ${index} __kept__ café 😀.`,
    ).join('\r\n') + '\r\n'
  await withFacade(source, (editor) => {
    const view = ctxOf(editor).get(editorViewCtx)
    const caret = (text: string) => {
      let position = -1
      view.state.doc.descendants((node, pos) => {
        if (node.isTextblock && node.textContent.startsWith(text))
          position = pos + 1 + node.content.size
      })
      expect(position).toBeGreaterThan(0)
      view.dispatch(
        view.state.tr.setSelection(
          TextSelection.create(view.state.doc, position),
        ),
      )
    }
    const action = (run: () => boolean) => {
      const before = preservationWork.characters
      expect(run()).toBe(true)
      expect(preservationWork.characters - before).toBeLessThan(10_000)
    }
    caret('Item 250 ')
    action(() => editor.keyDown({ key: 'Enter' }, 1))
    action(() => editor.insertText('Added 雪', 1))
    caret('Item 750 ')
    action(() => editor.insertText(' distant', 1))
    const expected = source
      .replace(
        '* [ ] Item 250 __kept__ café 😀.',
        '* [ ] Item 250 __kept__ café 😀.\r\n* [ ] Added 雪',
      )
      .replace(
        '* [ ] Item 750 __kept__ café 😀.',
        '* [ ] Item 750 **kept** café 😀. distant',
      )
    expect(editor.snapshot().text).toBe(expected)
    editor.loadDocument({
      documentId: 'reopened',
      generation: 2,
      format: 'md',
      text: expected,
    })
    expect(editor.snapshot().text).toBe(expected)
  })
}, 60_000)

describe('bounded item runs match whole-document preservation', () => {
  const seeds = Number(process.env.PRESERVATION_LIST_SEEDS) || 400
  const facade = facadeFixture('x\n')
  let accepted = 0
  let visited = 0
  const acceptedKinds = new Set<string>()
  afterAll(() => {
    // Selecting one seed does not claim coverage of the whole sample.
    if (visited !== seeds) return
    expect(accepted).toBeGreaterThan(seeds / 2)
    expect([...acceptedKinds].sort()).toEqual(['delete', 'insert', 'type'])
  })
  test.each(Array.from({ length: seeds }, (_, index) => index + 1))(
    'seed %i saves and reopens each accepted edit',
    (seed) => {
      visited++
      const editor = facade()
      const ctx = ctxOf(editor)
      const parse = ctx.get(parserCtx)
      let state = seed
      const random = () =>
        (state = (state * 1664525 + 1013904223) >>> 0) / 2 ** 32
      const pick = <T>(values: T[]) =>
        values[Math.floor(random() * values.length)]!
      const marker = pick(['-', '*', '+'])
      const ending = random() < 0.4 ? '\r\n' : '\n'
      const loose = random() < 0.2
      const tasks = random() < 0.5
      const nested = random() < 0.25
      const repeated = random() < 0.25
      const rows = Array.from(
        { length: 5 + Math.floor(random() * 10) },
        (_, index) =>
          `${marker} ${tasks ? (index % 3 ? '[ ] ' : '[x] ') : ''}${index % 2 ? '__kept__' : '**kept**'} ${repeated && index % 3 === 0 ? 'repeated' : index} café 😀` +
          (nested && index % 3 === 1 ? '\n  - child 雪' : ''),
      )
      const source =
        (random() < 0.1 ? '\uFEFF' : '') +
        (
          'Intro\n\n' +
          rows.join(loose ? '\n\n' : '\n') +
          '\n\nTail\n'
        ).replaceAll('\n', ending)
      const local = new Preservation(ctx, source)
      const whole = withoutFastPaths(new Preservation(ctx, source))
      const original = local.baseline
      const list = original.child(1)
      const items: ProseNode[] = []
      list.forEach((item) => items.push(item))
      for (let step = 0; step < 4; step++) {
        const action =
          step === 0 ? 'insert' : pick(['insert', 'delete', 'type'])
        const at = Math.floor(random() * items.length)
        if (action === 'insert') {
          const fresh = parse(
            `${marker} ${tasks ? '[ ] ' : ''}new ${seed} 雪\n`,
          ).firstChild!.firstChild!
          items.splice(at, 0, fresh)
        } else if (action === 'delete' && items.length > 2) items.splice(at, 1)
        else {
          const item = items[at]!
          const first = item.firstChild!
          if (first.type.name !== 'paragraph') continue
          const children: ProseNode[] = []
          item.forEach((child, _offset, index) =>
            children.push(
              index === 0
                ? first.copy(
                    first.content.append(
                      Fragment.from(first.type.schema.text(' typed 雪')),
                    ),
                  )
                : child,
            ),
          )
          items[at] = item.copy(Fragment.fromArray(children))
        }
        const changed = list.copy(Fragment.fromArray(items))
        const doc = original.copy(
          Fragment.fromArray([original.child(0), changed, original.child(2)]),
        )
        const fast = localEditsOf(local, doc)
        if (fast === undefined) continue
        accepted++
        acceptedKinds.add(action)
        expect(fast, `seed ${seed} step ${step}`).toBe(whole.serialize(doc))
        expectFacadeSave(editor, source, doc, fast, `seed ${seed} step ${step}`)
      }
    },
  )
})

test.each([
  ['numbering can change following items', '3) one\n4) two\n5) three\n'],
  ['comments can span blocks', '- one\n- two %% comment %%\n- three\n'],
])('item-run validation defers when %s', async (_, source) => {
  await withFacade(source, (editor) => {
    const ctx = ctxOf(editor)
    const preservation = new Preservation(ctx, source)
    const before = preservation.baseline
    const list = before.firstChild!
    const items = [list.child(0), list.child(1), list.child(1), list.child(2)]
    const doc = before.copy(Fragment.from(list.copy(Fragment.fromArray(items))))
    expect(localEditsOf(preservation, doc)).toBeUndefined()
    expect(preservation.serialize(doc)).toBe(
      withoutFastPaths(new Preservation(ctx, source)).serialize(doc),
    )
  })
})

test('HTML that makes a list literal stays on the whole-document path', async () => {
  const source = '- one\n- <span>two</span>\n- three\n'
  await withFacade(source, (editor) => {
    const ctx = ctxOf(editor)
    const preservation = new Preservation(ctx, source)
    const before = preservation.baseline
    const literal = before.firstChild!
    expect(literal.type.name).toBe('literal_markdown')
    const changed = literal.copy(
      Fragment.from(literal.type.schema.text(literal.textContent + '!')),
    )
    const doc = before.copy(Fragment.from(changed))
    expect(localEditsOf(preservation, doc)).toBeUndefined()
    const expected = withoutFastPaths(new Preservation(ctx, source)).serialize(
      doc,
    )
    expectFacadeSave(editor, source, doc, expected, 'HTML list edit')
  })
})
