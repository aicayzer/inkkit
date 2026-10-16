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
