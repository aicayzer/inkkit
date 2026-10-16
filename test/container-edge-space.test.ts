import { expect, test } from 'vitest'
import { InkKitEditor } from '../src/core'

const containers = [
  ['paragraph', 'alpha βeta\n'],
  ['multiline paragraph', 'first\nalpha βeta\nlast\n'],
  ['callout', '> [!NOTE]\n> alpha βeta\n'],
  ['compact callout', '>[!NOTE]\n>alpha βeta\n'],
  ['quote', '> alpha βeta\n'],
  ['multiline quote', '> first\n> alpha βeta\n> last\n'],
  ['multiline callout', '> [!NOTE]\n> first\n> alpha βeta\n> last\n'],
  ['list callout', '* > [!NOTE]\n  > alpha βeta\n'],
  ['list', '+   alpha βeta\n'],
  ['task', '* [x] alpha βeta\n'],
  ['nested callout', '> > [!tip]+ Title &amp; more\n> > alpha βeta\n'],
  ['footnote', 'Reference[^a]\n\n[^a]: alpha βeta\n'],
] as const

for (const [container, body] of containers)
  for (const method of ['replaceTextRange', 'replace'] as const)
    for (const edge of ['leading', 'trailing'] as const)
      test(`${method} ${edge === 'trailing' && container.startsWith('multiline') ? 'refuses' : 'saves and reopens'} a ${edge} space in a ${container}`, async () => {
        const root = document.createElement('div')
        document.body.append(root)
        const editor = await InkKitEditor.mount(root, {
          changed() {},
          copy() {},
          openLink() {},
        })
        const source = `__Before__ &amp;\n\n${body}\nAfter&#33;\n`.replaceAll(
          '\n',
          '\r\n',
        )
        try {
          editor.loadDocument({
            documentId: 'edge-space',
            generation: 1,
            format: 'md',
            text: source,
          })
          expect(editor.snapshot()).toMatchObject({
            text: source,
            dirty: false,
          })
          const target = edge === 'leading' ? 'alpha' : 'βeta'
          const edit = () => {
            if (method === 'replace') return editor.replace(target, '', 1)
            const snapshot = editor.textSnapshot()
            const from = snapshot.text.indexOf(target)
            expect(from).toBeGreaterThanOrEqual(0)
            return editor.replaceTextRange(
              {
                snapshotId: snapshot.snapshotId,
                from,
                to: from + target.length,
              },
              '',
            )
          }
          if (edge === 'trailing' && container.startsWith('multiline')) {
            // The reader trims decoded spaces before a soft break, including
            // character references. Keep refusing content it cannot reopen.
            const before = editor.snapshot()
            expect(edit).toThrow(
              expect.objectContaining({ code: 'preservation' }),
            )
            expect(editor.snapshot()).toEqual(before)
            expect(editor.undo()).toBe(false)
            return
          }
          expect(edit()).toBe(true)
          const saved = source.replace(
            'alpha βeta',
            edge === 'leading' ? '&#x20;βeta' : 'alpha&#x20;',
          )
          expect(editor.snapshot().text).toBe(saved)
          const readable = editor.textSnapshot().text
          const copied = await editor.clipboardSnapshot()
          expect(editor.undo()).toBe(true)
          expect(editor.snapshot()).toMatchObject({
            text: source,
            dirty: false,
          })
          expect(editor.redo()).toBe(true)
          expect(editor.snapshot().text).toBe(saved)
          editor.loadDocument({
            documentId: 'reopened',
            generation: 2,
            format: 'md',
            text: saved,
          })
          expect(editor.snapshot()).toMatchObject({ text: saved, dirty: false })
          expect(editor.textSnapshot().text).toBe(readable)
          const reopened = await editor.clipboardSnapshot()
          expect(reopened.text).toBe(copied.text)
          expect(reopened.html).toBe(copied.html)
        } finally {
          await editor.destroy()
          root.remove()
        }
      })

const indentedEdits = [
  ['indented callout', '> [!NOTE]\n>  alpha beta\n', 'alpha', ''],
  ['indented quote', '>    alpha beta\n', 'alpha', ''],
  ['bullet continuation', '+ first\n  alpha beta\n', 'alpha', ''],
  ['ordered continuation', '1. first\n   alpha beta\n', 'alpha', ''],
  ['task continuation', '- [x] first\n  alpha beta\n', 'alpha', ''],
  [
    'continuation with authored space',
    '+ first\n  alpha &#32;beta\n',
    'alpha',
    '',
  ],
  [
    'continuation with authored tab',
    '+ first\n  alpha &#x9;beta\n',
    'alpha',
    '',
  ],
  [
    'indented callout with authored space',
    '> [!NOTE]\n>  alpha &#32;beta\n',
    'alpha',
    '',
  ],
  [
    'untouched bullet continuation space',
    '+ alpha beta\n  &#x20;kept\n',
    'beta',
    'gamma',
  ],
  [
    'untouched ordered continuation space',
    '1. alpha beta\n   &#x20;kept\n',
    'beta',
    'gamma',
  ],
  [
    'untouched ordered continuation tab',
    '1. alpha beta\n   &#x9;kept\n',
    'beta',
    'gamma',
  ],
  [
    'untouched task continuation space',
    '- [x] alpha beta\n  &#x20;kept\n',
    'beta',
    'gamma',
  ],
] as const

for (const ending of ['\n', '\r\n'])
  for (const [name, body, target, replacement] of indentedEdits)
    for (const method of ['replaceTextRange', 'replace'] as const)
      test(`${method} preserves indentation in ${name} (${JSON.stringify(ending)})`, async () => {
        const root = document.body.appendChild(document.createElement('div'))
        const editor = await InkKitEditor.mount(root, {
          changed() {},
          copy() {},
          openLink() {},
        })
        const source = `__Before__ &amp;\n\n${body}\nAfter&#33;\n`.replaceAll(
          '\n',
          ending,
        )
        const saved = replacement
          ? source.replace(target, replacement)
          : source.replace('alpha ', '&#x20;')
        try {
          editor.loadDocument({
            documentId: 'indentation',
            generation: 1,
            format: 'md',
            text: source,
          })
          expect(editor.snapshot()).toMatchObject({
            text: source,
            dirty: false,
          })
          if (method === 'replace')
            expect(editor.replace(target, replacement, 1)).toBe(true)
          else {
            const snapshot = editor.textSnapshot()
            const from = snapshot.text.indexOf(target)
            expect(from).toBeGreaterThanOrEqual(0)
            expect(
              editor.replaceTextRange(
                {
                  snapshotId: snapshot.snapshotId,
                  from,
                  to: from + target.length,
                },
                replacement,
              ),
            ).toBe(true)
          }
          expect(editor.snapshot().text).toBe(saved)
          const readable = editor.textSnapshot().text
          const copied = await editor.clipboardSnapshot()
          editor.loadDocument({
            documentId: 'reopened',
            generation: 2,
            format: 'md',
            text: saved,
          })
          expect(editor.snapshot()).toMatchObject({ text: saved, dirty: false })
          expect(editor.textSnapshot().text).toBe(readable)
          const reopened = await editor.clipboardSnapshot()
          expect(reopened.text).toBe(copied.text)
          expect(reopened.html).toBe(copied.html)
        } finally {
          await editor.destroy()
          root.remove()
        }
      })
