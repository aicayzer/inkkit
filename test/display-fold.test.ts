import { expect, test } from 'vitest'
import { editorViewCtx } from '@milkdown/kit/core'
import { TextSelection } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import { InkKitError, type EditorOptions } from '../src/core'
import { foldedHeadings } from '../src/heading-fold'
import { ctxOf } from './editor-access'
import { input, withEditor, type Mounted } from './formats/harness'
import { doc, para, rich, withRichEditor } from './formats/rtf/harness'

const fold: EditorOptions = { display: { foldHeadings: true } }

const nested = [
  '# One',
  '',
  'one body',
  '',
  '## Two',
  '',
  'two body',
  '',
  '### Three',
  '',
  'three body',
  '',
  '## Four',
  '',
  'four body',
  '',
  '# Five',
  '',
  'five body',
  '',
].join('\n')

const view = (mounted: Mounted): EditorView =>
  ctxOf(mounted.editor).get(editorViewCtx)
const buttons = (mounted: Mounted) => [
  ...mounted.root.querySelectorAll<HTMLButtonElement>(
    '[data-inkkit-heading-toggle]',
  ),
]
/** The toggle in the heading that reads `text`. */
const toggleOf = (mounted: Mounted, text: string) =>
  buttons(mounted).find(
    (button) => button.parentElement!.parentElement!.textContent === text,
  )!
/** The text of each block the folds hide. */
const hidden = (mounted: Mounted) =>
  [...mounted.root.querySelectorAll('.inkkit-folded-content')].map(
    (element) => element.textContent,
  )
const load = (mounted: Mounted, text: string) =>
  mounted.editor.loadDocument(input('md', text))

test('folding hides what follows up to the next heading of the same or a higher level', () =>
  withEditor(fold, (mounted) => {
    load(mounted, nested)
    expect(buttons(mounted)).toHaveLength(5)
    expect(hidden(mounted)).toEqual([])
    toggleOf(mounted, 'Two').click()
    expect(hidden(mounted)).toEqual(['two body', 'Three', 'three body'])
    toggleOf(mounted, 'One').click()
    expect(hidden(mounted)).toEqual([
      'one body',
      'Two',
      'two body',
      'Three',
      'three body',
      'Four',
      'four body',
    ])
    toggleOf(mounted, 'Two').click()
    toggleOf(mounted, 'One').click()
    expect(hidden(mounted)).toEqual([])
  }))

test('folding and unfolding change nothing the host can read', () =>
  withEditor(fold, (mounted) => {
    const source = '# One\r\n\r\nbody\r\n\r\n## Two\r\n\r\ntail\r\n'
    load(mounted, source)
    const before = mounted.editor.snapshot()
    const states = mounted.states.length
    expect(mounted.editor.commandState().commands.undo).toBe(false)
    toggleOf(mounted, 'One').click()
    expect(hidden(mounted)).toHaveLength(3)
    expect(mounted.editor.snapshot()).toEqual(before)
    expect(mounted.editor.snapshot().text).toBe(source)
    toggleOf(mounted, 'One').click()
    expect(mounted.editor.snapshot()).toEqual(before)
    expect(mounted.changes).toEqual([])
    expect(mounted.editor.commandState().commands.undo).toBe(false)
    expect(mounted.editor.commandState().commands.redo).toBe(false)
    expect(mounted.states.length).toBeGreaterThanOrEqual(states)
  }))

test('a fold never enters the undo history', () =>
  withEditor(fold, (mounted) => {
    load(mounted, '# One\n\nbody\n')
    mounted.editor.find('body')
    mounted.editor.insertText('!', mounted.editor.snapshot().generation)
    const typed = mounted.editor.snapshot()
    expect(typed.text).toBe('# One\n\n!\n')
    toggleOf(mounted, 'One').click()
    expect(mounted.editor.snapshot()).toEqual(typed)
    // The undo takes back the typing, not the fold, and it opens the section it restores into.
    expect(mounted.editor.undo()).toBe(true)
    expect(mounted.editor.snapshot().text).toBe('# One\n\nbody\n')
    expect(hidden(mounted)).toEqual([])
    expect(mounted.editor.commandState().commands.undo).toBe(false)
  }))

test('a heading at the end of the document folds without hiding anything', () =>
  withEditor(fold, (mounted) => {
    load(mounted, 'intro\n\n## Last')
    toggleOf(mounted, 'Last').click()
    expect(hidden(mounted)).toEqual([])
    expect(toggleOf(mounted, 'Last').getAttribute('aria-expanded')).toBe(
      'false',
    )
    expect(mounted.editor.snapshot().text).toBe('intro\n\n## Last')
  }))

test('setext and ATX headings fold alike', () =>
  withEditor(fold, (mounted) => {
    load(
      mounted,
      'Title\n=====\n\nbody\n\nSub\n---\n\nsub body\n\n# Atx\n\natx body\n',
    )
    expect(buttons(mounted)).toHaveLength(3)
    toggleOf(mounted, 'Title').click()
    expect(hidden(mounted)).toEqual(['body', 'Sub', 'sub body'])
    expect(mounted.editor.snapshot().text).toBe(
      'Title\n=====\n\nbody\n\nSub\n---\n\nsub body\n\n# Atx\n\natx body\n',
    )
  }))

test('only top-level headings have a control', () =>
  withEditor(fold, (mounted) => {
    load(
      mounted,
      '> ## Quoted\n\n- ## Listed\n\n> [!NOTE]\n> ## In a callout\n\n## Top\n',
    )
    expect(buttons(mounted)).toHaveLength(1)
    expect(buttons(mounted)[0]!.getAttribute('aria-label')).toBe(
      'Fold section Top',
    )
  }))

test('a fold follows edits around it', () =>
  withEditor(fold, (mounted) => {
    load(mounted, '# One\n\nbody\n\n## Two\n\ntail\n\n# Three\n\nend\n')
    toggleOf(mounted, 'Two').click()
    expect(hidden(mounted)).toEqual(['tail'])
    // Text typed in the heading, and a block added above it, leave the fold on it.
    const v = view(mounted)
    const [two] = foldedHeadings(v.state)
    v.dispatch(v.state.tr.insertText('!', two! + 4))
    v.dispatch(
      v.state.tr.insert(0, v.state.schema.nodes.paragraph!.create(null)),
    )
    expect(hidden(mounted)).toEqual(['tail'])
    expect(foldedHeadings(v.state)).toHaveLength(1)
    expect(mounted.editor.snapshot().text).toContain('## Two!')
  }))

test('a level change changes what the fold hides', () =>
  withEditor(fold, (mounted) => {
    load(
      mounted,
      '# One\n\nbody\n\n## Two\n\ntail\n\n### Deep\n\nmore\n\n## Same\n\nlast\n',
    )
    const v = view(mounted)
    v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, 1)))
    toggleOf(mounted, 'Two').click()
    expect(hidden(mounted)).toEqual(['tail', 'Deep', 'more'])
    const [at] = foldedHeadings(v.state)
    const level = (next: number) =>
      v.dispatch(
        v.state.tr.setNodeMarkup(at!, undefined, {
          ...v.state.doc.nodeAt(at!)!.attrs,
          level: next,
        }),
      )
    // As a level 3 heading it stops at the next heading of level 3 or higher: Same.
    level(3)
    expect(hidden(mounted)).toEqual(['tail'])
    // As a level 1 heading it runs to the end.
    level(1)
    expect(hidden(mounted)).toEqual(['tail', 'Deep', 'more', 'Same', 'last'])
    expect(foldedHeadings(v.state)).toEqual([at])
  }))

test('deleting a folded heading reveals its content', () =>
  withEditor(fold, (mounted) => {
    load(mounted, '# One\n\nbody\n\n## Two\n\ntail\n\n## Next\n\nmore\n')
    toggleOf(mounted, 'Two').click()
    toggleOf(mounted, 'Next').click()
    expect(hidden(mounted)).toEqual(['tail', 'more'])
    const v = view(mounted)
    const [two] = foldedHeadings(v.state)
    const node = v.state.doc.nodeAt(two!)!
    v.dispatch(v.state.tr.delete(two!, two! + node.nodeSize))
    // Only the heading that went loses its fold, and the next heading keeps its own.
    expect(foldedHeadings(v.state)).toHaveLength(1)
    expect(hidden(mounted)).toEqual(['more'])
    expect(mounted.editor.snapshot().text).toBe(
      '# One\n\nbody\n\ntail\n\n## Next\n\nmore\n',
    )
  }))

test('find, a host selection and heading navigation open a folded section', () =>
  withEditor(fold, (mounted) => {
    load(mounted, '# One\n\nalpha\n\n## Two\n\nbeta\n\n# Three\n\ngamma\n')
    toggleOf(mounted, 'One').click()
    expect(hidden(mounted)).toHaveLength(3)
    expect(mounted.editor.find('beta')).toBe(true)
    expect(hidden(mounted)).toEqual([])

    toggleOf(mounted, 'One').click()
    expect(hidden(mounted)).toHaveLength(3)
    const snapshot = mounted.editor.textSnapshot()
    const at = snapshot.text.indexOf('alpha')
    mounted.editor.selectTextRange({
      snapshotId: snapshot.snapshotId,
      from: at,
      to: at,
    })
    expect(hidden(mounted)).toEqual([])

    toggleOf(mounted, 'One').click()
    expect(hidden(mounted)).toHaveLength(3)
    const target = mounted.editor.headings().find((h) => h.text === 'Two')!
    mounted.editor.navigateHeading(target)
    expect(hidden(mounted)).toEqual([])
    expect(foldedHeadings(view(mounted).state)).toEqual([])
  }))

test('a selection that moves into a folded section opens only that section', () =>
  withEditor(fold, (mounted) => {
    load(mounted, '# One\n\nalpha\n\n# Two\n\nbeta\n')
    toggleOf(mounted, 'One').click()
    toggleOf(mounted, 'Two').click()
    const v = view(mounted)
    let alpha = 0
    v.state.doc.descendants((node, pos) => {
      if (node.isText && node.text === 'alpha') alpha = pos
    })
    v.dispatch(
      v.state.tr.setSelection(TextSelection.create(v.state.doc, alpha + 2)),
    )
    expect(hidden(mounted)).toEqual(['beta'])
  }))

test('folding moves a selection inside the section to the heading', () =>
  withEditor(fold, (mounted) => {
    load(mounted, '# One\n\nalpha\n')
    mounted.editor.find('alpha')
    toggleOf(mounted, 'One').click()
    expect(hidden(mounted)).toEqual(['alpha'])
    expect(view(mounted).state.selection.$from.parent.type.name).toBe('heading')
  }))

test('a deletion that would reach hidden text opens its section first', () =>
  withEditor(fold, (mounted) => {
    load(mounted, '# One\n\nalpha\n\n# Two\n\nbeta\n')
    toggleOf(mounted, 'One').click()
    const v = view(mounted)
    let two = 0
    v.state.doc.descendants((node, pos) => {
      if (node.isText && node.text === 'Two') two = pos
    })
    v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, two)))
    const key = new KeyboardEvent('keydown', {
      key: 'Backspace',
      bubbles: true,
      cancelable: true,
    })
    v.dom.dispatchEvent(key)
    expect(hidden(mounted)).toEqual([])
    expect(mounted.editor.snapshot().text).toBe(
      '# One\n\nalpha\n\n# Two\n\nbeta\n',
    )
  }))

test('turning the option off removes the controls and folds, and on starts unfolded', () =>
  withEditor(fold, (mounted) => {
    load(mounted, nested)
    toggleOf(mounted, 'One').click()
    expect(hidden(mounted).length).toBeGreaterThan(0)
    mounted.editor.setDisplayPreferences({})
    expect(buttons(mounted)).toEqual([])
    expect(hidden(mounted)).toEqual([])
    expect(view(mounted).dom.hasAttribute('data-inkkit-fold-headings')).toBe(
      false,
    )
    mounted.editor.setDisplayPreferences({ foldHeadings: true })
    expect(buttons(mounted)).toHaveLength(5)
    expect(hidden(mounted)).toEqual([])
    expect(mounted.editor.snapshot().text).toBe(nested)
    expect(mounted.changes).toEqual([])
  }))

test('the setter replaces the whole set', () =>
  withEditor(undefined, (mounted) => {
    load(mounted, '# One\n\n```js\na\nb\n```\n')
    expect(buttons(mounted)).toEqual([])
    mounted.editor.setDisplayPreferences({
      foldHeadings: true,
      codeLineNumbers: true,
    })
    expect(buttons(mounted)).toHaveLength(1)
    expect(mounted.root.querySelectorAll('.inkkit-line-number')).toHaveLength(2)
    mounted.editor.setDisplayPreferences({ codeLineNumbers: true })
    expect(buttons(mounted)).toEqual([])
    expect(mounted.root.querySelectorAll('.inkkit-line-number')).toHaveLength(2)
    mounted.editor.setDisplayPreferences({ foldHeadings: undefined })
    expect(mounted.root.querySelectorAll('.inkkit-line-number')).toHaveLength(0)
  }))

test('the preference survives a load, and a new load starts unfolded', () =>
  withEditor(fold, (mounted) => {
    load(mounted, '# One\n\nbody\n')
    toggleOf(mounted, 'One').click()
    load(mounted, '# Two\n\nother\n')
    expect(buttons(mounted)).toHaveLength(1)
    expect(hidden(mounted)).toEqual([])
  }))

test('a switch to source and back clears the folds', () =>
  withEditor(fold, (mounted) => {
    load(mounted, '# One\n\nbody\n')
    toggleOf(mounted, 'One').click()
    expect(hidden(mounted)).toEqual(['body'])
    mounted.editor.setEditingMode('source')
    mounted.editor.setEditingMode('formatted')
    expect(hidden(mounted)).toEqual([])
    expect(buttons(mounted)).toHaveLength(1)
    expect(mounted.editor.snapshot().text).toBe('# One\n\nbody\n')
  }))

test('a read-only editor can still fold', () =>
  withEditor({ ...fold, editable: false }, (mounted) => {
    load(mounted, '# One\n\nbody\n')
    toggleOf(mounted, 'One').click()
    expect(hidden(mounted)).toEqual(['body'])
    expect(mounted.editor.snapshot().dirty).toBe(false)
  }))

test('a fold control is a named button whose state and hidden content are exposed', () =>
  withEditor(fold, (mounted) => {
    load(mounted, '# One\n\nbody\n')
    const button = toggleOf(mounted, 'One')
    expect(button.tagName).toBe('BUTTON')
    expect(button.type).toBe('button')
    expect(button.tabIndex).toBe(0)
    expect(button.getAttribute('aria-label')).toBe('Fold section One')
    expect(button.getAttribute('aria-expanded')).toBe('true')
    button.click()
    expect(button.getAttribute('aria-expanded')).toBe('false')
    expect(button.getAttribute('aria-label')).toBe('Unfold section One')
    expect(
      mounted.root
        .querySelector('.inkkit-folded-content')!
        .getAttribute('aria-hidden'),
    ).toBe('true')
    // The name follows the heading's text, and the button stays the same element.
    const v = view(mounted)
    v.dispatch(v.state.tr.insertText('Two', 2))
    expect(button.isConnected).toBe(true)
    expect(button.getAttribute('aria-label')).toBe('Unfold section OTwone')
  }))

test('labels name the controls', () =>
  withEditor(
    {
      ...fold,
      labels: { foldHeading: 'Hide section', unfoldHeading: 'Show section' },
    },
    (mounted) => {
      load(mounted, '# One\n\nbody\n')
      const button = buttons(mounted)[0]!
      expect(button.getAttribute('aria-label')).toBe('Hide section One')
      button.click()
      expect(button.getAttribute('aria-label')).toBe('Show section One')
    },
  ))

test('folding follows unusual markers, Unicode and an emoji heading', () =>
  withEditor(fold, (mounted) => {
    const source =
      '* item\n\n## Café \u{1F600}\n\n1) one\n\n+ plus\n\n## Next\n\nz\n'
    load(mounted, source)
    toggleOf(mounted, 'Café \u{1F600}').click()
    expect(hidden(mounted)).toHaveLength(2)
    expect(mounted.editor.snapshot().text).toBe(source)
  }))

test('an RTF document, which has no headings, gets no control', () =>
  withRichEditor(fold, (mounted) => {
    mounted.editor.loadDocument(rich(doc(para('Plain'))))
    expect(
      mounted.root.querySelectorAll('[data-inkkit-heading-toggle]'),
    ).toHaveLength(0)
    mounted.editor.setDisplayPreferences({ foldHeadings: true })
    expect(
      mounted.root.querySelectorAll('[data-inkkit-heading-toggle]'),
    ).toHaveLength(0)
  }))

test('invalid display values throw an InkKitError and change nothing', () =>
  withEditor(fold, async (mounted) => {
    load(mounted, '# One\n\nbody\n')
    for (const value of [
      null,
      'on',
      [],
      { foldHeadings: 'yes' },
      { codeLineNumbers: 1 },
      { unknown: true },
    ]) {
      expect(() =>
        mounted.editor.setDisplayPreferences(value as never),
      ).toThrow(InkKitError)
    }
    expect(buttons(mounted)).toHaveLength(1)
    const root = document.createElement('div')
    await expect(
      (await import('../src/core')).InkKitEditor.mount(root, { changed() {} }, {
        display: { foldHeadings: 'yes' },
      } as never),
    ).rejects.toMatchObject({ code: 'invalid-argument' })
  }))

test('display preferences are refused during composition', () =>
  withEditor(fold, (mounted) => {
    load(mounted, '# One\n\nbody\n')
    view(mounted).dom.dispatchEvent(new CompositionEvent('compositionstart'))
    expect(() =>
      mounted.editor.setDisplayPreferences({ foldHeadings: false }),
    ).toThrow(expect.objectContaining({ code: 'composition' }))
    view(mounted).dom.dispatchEvent(new CompositionEvent('compositionend'))
  }))
