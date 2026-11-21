import { expect, test, vi } from 'vitest'
import { editorViewCtx } from '@milkdown/kit/core'
import { Node as ProseNode } from '@milkdown/kit/prose/model'
import { AllSelection, TextSelection } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import { InkKitEditor, InkKitError, type EditorOptions } from '../src/core'
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
/** Waits until a section that opened has been shown: a frame, then a task after its paint. */
const shown = () => new Promise((resolve) => setTimeout(resolve, 150))

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
    expect(
      mounted.root
        .querySelector('.inkkit-code-gutter')
        ?.getAttribute('data-inkkit-numbers'),
    ).toBe('1\n2')
    mounted.editor.setDisplayPreferences({ codeLineNumbers: true })
    expect(buttons(mounted)).toEqual([])
    expect(
      mounted.root
        .querySelector('.inkkit-code-gutter')
        ?.getAttribute('data-inkkit-numbers'),
    ).toBe('1\n2')
    mounted.editor.setDisplayPreferences({ foldHeadings: undefined })
    expect(mounted.root.querySelector('.inkkit-code-gutter')).toBeNull()
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
    expect(mounted.root.querySelector('.inkkit-folded-content')).not.toBeNull()
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

/** The position of the heading that reads `text`, and of the block after the section. */
const headingPos = (v: EditorView, text: string): number => {
  let found = -1
  v.state.doc.forEach((node, offset) => {
    if (node.type.name === 'heading' && node.textContent === text)
      found = offset
  })
  return found
}

const outline = '# One\n\nHidden\n\n# Two\n'

test('a fold sits beside its heading, outside it, and leaves the heading its own text', () =>
  withEditor(fold, (mounted) => {
    load(mounted, '# One %%private%%\n\nbody\n\n> ## Nested\n')
    const heading = mounted.root.querySelector('h1')!
    const wrapper = heading.parentElement!
    expect(wrapper.classList.contains('inkkit-heading-block')).toBe(true)
    expect(heading.querySelector('button')).toBeNull()
    expect(heading.querySelector('[data-inkkit-heading-toggle]')).toBeNull()
    const control = wrapper.querySelector('.inkkit-heading-fold')!
    expect(control.parentElement).toBe(wrapper)
    expect(control.getAttribute('contenteditable')).toBe('false')
    expect(control.closest('[aria-hidden="true"]')).toBeNull()
    // The heading's text is its own, and the name of its control leaves a hidden comment out.
    expect(heading.textContent).toBe('One private')
    const button = control.querySelector('button')!
    expect(button.getAttribute('aria-label')).toBe('Fold section One')
    // A heading that cannot fold is the plain element.
    const nested = mounted.root.querySelector('blockquote h2')!
    expect(nested.parentElement!.tagName).toBe('BLOCKQUOTE')
    expect(mounted.root.querySelectorAll('.inkkit-heading-block')).toHaveLength(
      1,
    )
  }))

test('with the option off a heading is the plain element, and turning it on and off swaps it', () =>
  withEditor(undefined, (mounted) => {
    load(mounted, '# One\n\nbody\n')
    const plain = mounted.root.querySelector('h1')!
    expect(plain.parentElement!.classList.contains('ProseMirror')).toBe(true)
    mounted.editor.setDisplayPreferences({ foldHeadings: true })
    const wrapped = mounted.root.querySelector('h1')!
    expect(
      wrapped.parentElement!.classList.contains('inkkit-heading-block'),
    ).toBe(true)
    mounted.editor.setDisplayPreferences({})
    expect(
      mounted.root
        .querySelector('h1')!
        .parentElement!.classList.contains('ProseMirror'),
    ).toBe(true)
    expect(
      mounted.root.querySelector('[data-inkkit-heading-toggle]'),
    ).toBeNull()
    expect(mounted.editor.snapshot().text).toBe('# One\n\nbody\n')
  }))

test('a comment that shows is named by the control, and one that hides is not', () =>
  withEditor(fold, (mounted) => {
    load(mounted, '# One %%private%%\n')
    const button = buttons(mounted)[0]!
    expect(button.getAttribute('aria-label')).toBe('Fold section One')
    mounted.editor.setCommentsVisible(true)
    expect(button.getAttribute('aria-label')).toContain('private')
    mounted.editor.setCommentsVisible(false)
    expect(button.getAttribute('aria-label')).toBe('Fold section One')
  }))

test('a person edit that reaches folded text is refused and opens the section', () =>
  withEditor(fold, (mounted) => {
    load(mounted, outline)
    toggleOf(mounted, 'One').click()
    const v = view(mounted)
    const revision = mounted.editor.snapshot().revision
    const one = headingPos(v, 'One')
    const hiddenStart = one + v.state.doc.nodeAt(one)!.nodeSize
    const attempts: ((v: EditorView) => void)[] = [
      // Delete forward from the end of the heading, joining the hidden paragraph.
      (v) => v.dispatch(v.state.tr.delete(hiddenStart - 1, hiddenStart + 1)),
      // Delete backward from the start of the next heading.
      (v) => {
        const two = headingPos(v, 'Two')
        v.dispatch(v.state.tr.delete(two - 1, two + 1))
      },
      // Type into the hidden paragraph, and replace it.
      (v) => v.dispatch(v.state.tr.insertText('x', hiddenStart + 2)),
      (v) =>
        v.dispatch(v.state.tr.replaceWith(hiddenStart, hiddenStart + 8, [])),
    ]
    for (const attempt of attempts) {
      load(mounted, outline)
      toggleOf(mounted, 'One').click()
      expect(hidden(mounted)).toEqual(['Hidden'])
      const before = mounted.editor.snapshot()
      attempt(view(mounted))
      expect(mounted.editor.snapshot()).toEqual(before)
      expect(hidden(mounted)).toEqual([])
      expect(foldedHeadings(view(mounted).state)).toEqual([])
    }
    expect(mounted.changes).toEqual([])
    expect(mounted.editor.commandState().commands.undo).toBe(false)
    expect(mounted.editor.snapshot().revision).toBeGreaterThanOrEqual(revision)
  }))

test('an edit a fold does not reach goes through and leaves the fold', () =>
  withEditor(fold, (mounted) => {
    load(mounted, outline)
    toggleOf(mounted, 'One').click()
    const v = view(mounted)
    const two = headingPos(v, 'Two')
    v.dispatch(v.state.tr.insertText('!', two + 4))
    expect(mounted.editor.snapshot().text).toBe('# One\n\nHidden\n\n# Two!\n')
    expect(hidden(mounted)).toEqual(['Hidden'])
    const one = headingPos(v, 'One')
    v.dispatch(v.state.tr.insertText('!', one + 4))
    expect(mounted.editor.snapshot().text).toBe('# One!\n\nHidden\n\n# Two!\n')
    expect(hidden(mounted)).toEqual(['Hidden'])
  }))

test('a selection that covers a whole folded section may replace or delete it', () =>
  withEditor(fold, (mounted) => {
    load(mounted, 'Intro\n\n# One\n\nHidden\n\n# Two\n')
    toggleOf(mounted, 'One').click()
    const v = view(mounted)
    const one = headingPos(v, 'One')
    const two = headingPos(v, 'Two')
    // From the intro to the next heading covers the whole section, heading included.
    v.dispatch(
      v.state.tr.setSelection(TextSelection.create(v.state.doc, 1, two + 1)),
    )
    v.dispatch(v.state.tr.deleteSelection())
    expect(mounted.editor.snapshot().text).not.toContain('Hidden')
    expect(one).toBeGreaterThan(0)
  }))

test('a selection that reaches the hidden text opens the section before anything acts on it', () =>
  withEditor(fold, async (mounted) => {
    load(mounted, outline)
    toggleOf(mounted, 'One').click()
    const v = view(mounted)
    const one = headingPos(v, 'One')
    const two = headingPos(v, 'Two')
    // From the end of the heading's text to the start of the next heading's, hidden text between.
    v.dispatch(
      v.state.tr.setSelection(
        TextSelection.create(v.state.doc, one + 4, two + 1),
      ),
    )
    expect(foldedHeadings(v.state)).toEqual([])
    expect(hidden(mounted)).toEqual([])
    // The section has not been painted, so the same input cannot also change its text.
    v.dispatch(v.state.tr.deleteSelection())
    expect(mounted.editor.snapshot().text).toBe(outline)
    expect(mounted.changes).toEqual([])
    // Once it has been shown, what the person deletes is what they see selected.
    await shown()
    v.dispatch(v.state.tr.deleteSelection())
    expect(mounted.editor.snapshot().text).toBe('# OneTwo\n')
  }))

test('every edit over a selection that reaches the hidden text acts on text that is shown', () =>
  withEditor(fold, async (mounted) => {
    const source = 'Intro\n\n# One\n\nHidden words\n\n# Two\n'
    const reach = async () => {
      load(mounted, source)
      toggleOf(mounted, 'One').click()
      const v = view(mounted)
      const one = headingPos(v, 'One')
      const two = headingPos(v, 'Two')
      expect(foldedHeadings(v.state)).toHaveLength(1)
      // Partway into the heading to partway into the next one.
      v.dispatch(
        v.state.tr.setSelection(
          TextSelection.create(v.state.doc, one + 2, two + 3),
        ),
      )
      expect(foldedHeadings(v.state)).toEqual([])
      expect(hidden(mounted)).toEqual([])
      return v
    }
    const settled = async () => {
      const v = await reach()
      await shown()
      return v
    }
    for (const [act, text] of [
      [(v: EditorView) => v.dispatch(v.state.tr.deleteSelection()), '# Oo'],
      [(v: EditorView) => v.dispatch(v.state.tr.insertText('x')), '# Oxo'],
      [
        () =>
          mounted.editor.insertText('x', mounted.editor.snapshot().generation),
        '# Oxo',
      ],
      [
        () =>
          mounted.editor.keyDown(
            { key: 'Backspace' },
            mounted.editor.snapshot().generation,
          ),
        '# Oo',
      ],
      [
        () =>
          mounted.editor.keyDown(
            { key: 'Delete' },
            mounted.editor.snapshot().generation,
          ),
        '# Oo',
      ],
    ] as const) {
      // Straight after the selection opened the section, the edit is refused.
      try {
        act(await reach())
      } catch (error) {
        expect((error as InkKitError).code).toBe('hidden-text')
      }
      expect(mounted.editor.snapshot().text).toBe(source)
      act(await settled())
      // The text the edit changed was the text that was selected and shown.
      expect(mounted.editor.snapshot().text).toBe(`Intro\n\n${text}\n`)
    }
  }))

test('a selection that starts in the hidden text or ends in it opens the section', () =>
  withEditor(fold, (mounted) => {
    load(mounted, 'Intro\n\n# One\n\nHidden words\n\n# Two\n')
    const v = view(mounted)
    const one = headingPos(v, 'One')
    const two = headingPos(v, 'Two')
    for (const [from, to] of [
      [1, one + 4 + 4],
      [one + 4 + 4, two + 1],
    ] as const) {
      toggleOf(mounted, 'One').click()
      expect(foldedHeadings(v.state)).toHaveLength(1)
      v.dispatch(
        v.state.tr.setSelection(TextSelection.create(v.state.doc, from, to)),
      )
      expect(foldedHeadings(v.state)).toEqual([])
    }
  }))

test('select-all covers every section and leaves them folded', () =>
  withEditor(fold, (mounted) => {
    load(mounted, nested)
    for (const button of buttons(mounted)) button.click()
    const v = view(mounted)
    const folded = foldedHeadings(v.state)
    expect(folded.length).toBeGreaterThan(0)
    v.dispatch(v.state.tr.setSelection(new AllSelection(v.state.doc)))
    expect(foldedHeadings(v.state)).toEqual(folded)
    v.dispatch(v.state.tr.deleteSelection())
    expect(mounted.editor.snapshot().text).toBe('')
  }))

test('a deletion from a caret across the fold boundary opens the section and changes nothing', () =>
  withEditor(fold, (mounted) => {
    load(mounted, outline)
    toggleOf(mounted, 'One').click()
    const v = view(mounted)
    const one = headingPos(v, 'One')
    v.dispatch(
      v.state.tr.setSelection(TextSelection.create(v.state.doc, one + 4)),
    )
    // The caret is at the heading's end; a deletion that joins the hidden paragraph is refused.
    v.dispatch(v.state.tr.delete(one + 4, one + 6))
    expect(mounted.editor.snapshot().text).toBe(outline)
    expect(foldedHeadings(v.state)).toEqual([])
  }))

test('only a host operation that names its target may change folded text', () =>
  withEditor(fold, (mounted) => {
    load(mounted, 'Hidden words\n\n# One\n\nHidden words\n\n# Two\n')
    toggleOf(mounted, 'One').click()
    const snapshot = mounted.editor.textSnapshot()
    const at = snapshot.text.lastIndexOf('Hidden')
    expect(
      mounted.editor.replaceTextRange(
        { snapshotId: snapshot.snapshotId, from: at, to: at + 6 },
        'Shown',
      ),
    ).toBe(true)
    expect(mounted.editor.snapshot().text).toBe(
      'Hidden words\n\n# One\n\nShown words\n\n# Two\n',
    )
  }))

test('moving a folded heading keeps its fold through undo and redo', () =>
  withEditor(fold, (mounted) => {
    load(mounted, 'Intro\n\n# One\n\nBody\n\n# Two\n')
    expect(mounted.editor.find('One')).toBe(true)
    toggleOf(mounted, 'One').click()
    const moved = '# One\n\nIntro\n\nBody\n\n# Two\n'
    const original = 'Intro\n\n# One\n\nBody\n\n# Two\n'
    expect(mounted.editor.moveBlock('up')).toBe(true)
    expect(mounted.editor.snapshot().text).toBe(moved)
    for (const [step, text, body] of [
      [() => mounted.editor.undo(), original, ['Body']],
      [() => mounted.editor.redo(), moved, ['Intro', 'Body']],
      [() => mounted.editor.undo(), original, ['Body']],
    ] as const) {
      expect(step()).toBe(true)
      expect(mounted.editor.snapshot().text).toBe(text)
      expect(foldedHeadings(view(mounted).state)).toHaveLength(1)
      expect(hidden(mounted)).toEqual(body)
      expect(toggleOf(mounted, 'One').getAttribute('aria-expanded')).toBe(
        'false',
      )
    }
  }))

test('an edit in an open section reads the document no more often for more folded sections', () =>
  withEditor(fold, (mounted) => {
    // Reads of the top-level blocks while the state takes one typed character, with every section
    // but the last folded. The count must not grow with the number of folds.
    const reads = (sections: number) => {
      load(
        mounted,
        Array.from(
          { length: sections },
          (_, i) => `# Section ${i}\n\nfirst ${i}\n\nsecond ${i}\n`,
        ).join('\n'),
      )
      for (const button of buttons(mounted).slice(0, -1)) button.click()
      const v = view(mounted)
      expect(foldedHeadings(v.state)).toHaveLength(sections - 1)
      const at = v.state.doc.content.size - 3
      const spy = vi.spyOn(ProseNode.prototype, 'forEach')
      try {
        v.state.apply(v.state.tr.insertText('x', at))
        return spy.mock.calls.length
      } finally {
        spy.mockRestore()
      }
    }
    const few = reads(10)
    expect(few).toBeLessThan(10)
    expect(reads(40)).toBe(few)
  }))

test('the same display preferences announce nothing and a change announces once', () =>
  withEditor({ display: { foldHeadings: true } }, (mounted) => {
    load(mounted, outline)
    mounted.states.length = 0
    mounted.editor.setDisplayPreferences({ foldHeadings: true })
    mounted.editor.setDisplayPreferences({
      foldHeadings: true,
      codeLineNumbers: false,
    })
    expect(mounted.states).toHaveLength(0)
    mounted.editor.setDisplayPreferences({ foldHeadings: false })
    expect(mounted.states).toHaveLength(1)
    mounted.editor.setDisplayPreferences({ foldHeadings: false })
    expect(mounted.states).toHaveLength(1)
  }))

test('a host call names what it changes, even in folded text', () =>
  withEditor(fold, (mounted) => {
    load(mounted, outline)
    toggleOf(mounted, 'One').click()
    expect(mounted.editor.replaceAll('Hidden', 'Shown')).toBe(1)
    expect(mounted.editor.snapshot().text).toBe('# One\n\nShown\n\n# Two\n')
    expect(hidden(mounted)).toEqual(['Shown'])
  }))

test('moving a folded heading keeps its fold', () =>
  withEditor(fold, (mounted) => {
    load(mounted, 'Intro\n\n# One\n\nBody\n\n# Two\n')
    expect(mounted.editor.find('One')).toBe(true)
    toggleOf(mounted, 'One').click()
    expect(hidden(mounted)).toEqual(['Body'])
    expect(mounted.editor.moveBlock('up')).toBe(true)
    expect(mounted.editor.snapshot().text).toBe(
      '# One\n\nIntro\n\nBody\n\n# Two\n',
    )
    expect(foldedHeadings(view(mounted).state)).toHaveLength(1)
    expect(hidden(mounted)).toEqual(['Intro', 'Body'])
    expect(toggleOf(mounted, 'One').getAttribute('aria-expanded')).toBe('false')
    expect(mounted.editor.snapshot().dirty).toBe(true)
  }))

const code = (run: () => unknown) => {
  try {
    run()
  } catch (error) {
    return (error as InkKitError).code
  }
  return undefined
}

test('a section that a selection opened is not changed until it has been shown', () =>
  withEditor(fold, async (mounted) => {
    load(mounted, outline)
    toggleOf(mounted, 'One').click()
    const snapshot = mounted.editor.textSnapshot()
    const at = snapshot.text.indexOf('Hidden')
    mounted.editor.selectTextRange({
      snapshotId: snapshot.snapshotId,
      from: at,
      to: at + 6,
    })
    expect(hidden(mounted)).toEqual([])
    const generation = mounted.editor.snapshot().generation
    // The same task cannot also change what the selection has just revealed. The call reports it.
    expect(code(() => mounted.editor.insertText('x', generation))).toBe(
      'hidden-text',
    )
    expect(mounted.editor.snapshot().text).toBe(outline)
    expect(mounted.changes).toEqual([])
    // A forwarded key is consumed, which keyDown reports as handled.
    expect(mounted.editor.keyDown({ key: 'Backspace' }, generation)).toBe(true)
    expect(mounted.editor.snapshot().text).toBe(outline)
    await shown()
    expect(mounted.editor.insertText('x', generation)).toBe(true)
    expect(mounted.editor.snapshot().text).toBe('# One\n\nx\n\n# Two\n')
  }))

test('editReferenceDefinition changes a definition under a fold in one call', () =>
  withEditor(fold, (mounted) => {
    load(
      mounted,
      'See [link][id].\n\n# One\n\n[id]: https://old.example\n\n# Two\n',
    )
    toggleOf(mounted, 'One').click()
    const revision = mounted.editor.snapshot().revision
    expect(
      mounted.editor.editReferenceDefinition('id', 'https://new.example'),
    ).toBe(true)
    const after = mounted.editor.snapshot()
    expect(after.text).toContain('[id]: https://new.example')
    expect(after.revision).not.toBe(revision)
  }))

test('a backward find between two folded matches opens neither on the way', () =>
  withEditor(fold, (mounted) => {
    load(
      mounted,
      'Intro\n\n# One\n\nneedle one\n\n# Two\n\nneedle two\n\n# Three\n\nplain\n',
    )
    toggleOf(mounted, 'One').click()
    toggleOf(mounted, 'Two').click()
    const v = view(mounted)
    const two = headingPos(v, 'Two')
    // The caret sits between the matches, at the end of the second heading.
    v.dispatch(
      v.state.tr.setSelection(TextSelection.create(v.state.doc, two + 4)),
    )
    expect(foldedHeadings(v.state)).toHaveLength(2)
    const session = mounted.editor.findSession(() => {})
    expect(session.find('needle', { direction: 'previous' })).toBe(true)
    // Only the section of the match that was asked for opens.
    expect(foldedHeadings(v.state)).toEqual([headingPos(v, 'Two')])
    session.close()
  }))

/** Selects `text` in the document, which opens the section that hides it. */
const select = (mounted: Mounted, text: string) => {
  const snapshot = mounted.editor.textSnapshot()
  const from = snapshot.text.indexOf(text)
  mounted.editor.selectTextRange({
    snapshotId: snapshot.snapshotId,
    from,
    to: from + text.length,
  })
}

const edit = (mounted: Mounted) =>
  code(() =>
    mounted.editor.insertText('x', mounted.editor.snapshot().generation),
  )

test('an edit queued in the host`s next animation frame is refused until a paint has passed', () =>
  withEditor(fold, async (mounted) => {
    load(mounted, outline)
    toggleOf(mounted, 'One').click()
    // The editor's frame callback runs first, then the host's, before the frame paints.
    select(mounted, 'Hidden')
    const queued = await new Promise<string | undefined>((resolve) =>
      requestAnimationFrame(() => resolve(edit(mounted))),
    )
    expect(queued).toBe('hidden-text')
    expect(mounted.editor.snapshot().text).toBe(outline)
    await shown()
    expect(edit(mounted)).toBeUndefined()
  }))

test('a hidden page keeps the section protected until it shows', () =>
  withEditor(fold, async (mounted) => {
    let hidden = true
    const state = vi
      .spyOn(document, 'visibilityState', 'get')
      .mockImplementation(() => (hidden ? 'hidden' : 'visible'))
    try {
      load(mounted, outline)
      toggleOf(mounted, 'One').click()
      select(mounted, 'Hidden')
      // Far longer than the old fallback timer, with frames suppressed.
      await new Promise((resolve) => setTimeout(resolve, 400))
      expect(edit(mounted)).toBe('hidden-text')
      hidden = false
      document.dispatchEvent(new Event('visibilitychange'))
      await shown()
      expect(edit(mounted)).toBeUndefined()
    } finally {
      state.mockRestore()
    }
  }))

test('a display update that leaves folding on keeps the section protected', () =>
  withEditor(fold, async (mounted) => {
    load(mounted, outline)
    toggleOf(mounted, 'One').click()
    select(mounted, 'Hidden')
    mounted.editor.setDisplayPreferences({
      foldHeadings: true,
      codeLineNumbers: true,
    })
    expect(edit(mounted)).toBe('hidden-text')
    expect(mounted.editor.snapshot().text).toBe(outline)
    await shown()
    expect(edit(mounted)).toBeUndefined()
  }))

test('a heading that becomes a paragraph keeps its former body protected', () =>
  withEditor(fold, async (mounted) => {
    load(mounted, outline)
    toggleOf(mounted, 'One').click()
    const v = view(mounted)
    v.dispatch(
      v.state.tr.setSelection(
        TextSelection.create(v.state.doc, 2, headingPos(v, 'Two') - 4),
      ),
    )
    v.dispatch(v.state.tr.setBlockType(1, 1, v.state.schema.nodes.paragraph!))
    expect(mounted.editor.snapshot().text).toBe('One\n\nHidden\n\n# Two\n')
    expect(edit(mounted)).toBe('hidden-text')
    await shown()
    expect(edit(mounted)).toBeUndefined()
  }))

test('formatting is refused on text a section has not shown and on folded text, and reports hidden-text', () =>
  withEditor(fold, async (mounted) => {
    load(mounted, outline)
    toggleOf(mounted, 'One').click()
    const generation = () => mounted.editor.snapshot().generation
    select(mounted, 'Hidden')
    expect(
      code(() => mounted.editor.format('bold', undefined, generation())),
    ).toBe('hidden-text')
    expect(mounted.editor.snapshot().text).toBe(outline)
    await shown()
    // A select-all covers the folded section, and formatting is not a deletion.
    toggleOf(mounted, 'One').click()
    const v = view(mounted)
    expect(foldedHeadings(v.state)).toHaveLength(1)
    v.dispatch(v.state.tr.setSelection(new AllSelection(v.state.doc)))
    expect(foldedHeadings(v.state)).toHaveLength(1)
    expect(
      code(() => mounted.editor.format('bold', undefined, generation())),
    ).toBe('hidden-text')
    expect(mounted.editor.snapshot().text).toBe(outline)
    expect(foldedHeadings(v.state)).toEqual([])
  }))

test('a shortcut on text a section has not shown is consumed and reported to events.error', async () => {
  const root = document.createElement('div')
  document.body.append(root)
  const failures: string[] = []
  const editor = await InkKitEditor.mount(
    root,
    { changed() {}, error: (error) => failures.push(error.code) },
    fold,
  )
  try {
    editor.setKeymap({ bold: ['Ctrl-b'] })
    editor.loadDocument(input('md', outline))
    root
      .querySelector<HTMLButtonElement>('[data-inkkit-heading-toggle]')!
      .click()
    const snapshot = editor.textSnapshot()
    const from = snapshot.text.indexOf('Hidden')
    editor.selectTextRange({
      snapshotId: snapshot.snapshotId,
      from,
      to: from + 6,
    })
    expect(
      editor.keyDown(
        { key: 'b', code: 'KeyB', ctrlKey: true },
        editor.snapshot().generation,
      ),
    ).toBe(true)
    expect(editor.snapshot().text).toBe(outline)
    expect(failures).toEqual(['hidden-text'])
  } finally {
    await editor.destroy()
    root.remove()
  }
})
