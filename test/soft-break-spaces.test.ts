import { expect, test } from 'vitest'
import { InkKitEditor } from '../src/core'

const containers = [
  ['paragraph', 'αlpha\nβeta'],
  ['quote', '> αlpha\n> βeta'],
  ['callout', '> [!NOTE]\n> αlpha\n> βeta'],
  ['list', '+ αlpha\n  βeta'],
  ['task', '- [x] αlpha\n  βeta'],
] as const

for (const ending of ['\n', '\r\n'])
  for (const [name, body] of containers)
    for (const side of ['before', 'after'] as const)
      test(`space ${side} soft break in ${name} (${JSON.stringify(ending)})`, async () => {
        const root = document.body.appendChild(document.createElement('div'))
        const editor = await InkKitEditor.mount(root, {
          changed() {},
          copy() {},
          openLink() {},
        })
        const source = `__Before__ &amp;\n\n${body}\n\nAfter&#33;\n`.replaceAll(
          '\n',
          ending,
        )
        const saved =
          side === 'before'
            ? source.replace('αlpha', 'αlpha&#x20;')
            : source.replace('βeta', '&#x20;βeta')
        try {
          editor.loadDocument({
            documentId: 'soft-break',
            generation: 1,
            format: 'md',
            text: source,
          })
          expect(editor.snapshot()).toMatchObject({
            text: source,
            dirty: false,
          })
          const snapshot = editor.textSnapshot()
          const from =
            side === 'before'
              ? snapshot.text.indexOf('αlpha') + 5
              : snapshot.text.indexOf('βeta')
          expect(
            editor.replaceTextRange(
              { snapshotId: snapshot.snapshotId, from, to: from },
              ' ',
            ),
          ).toBe(true)
          expect(editor.snapshot().text).toBe(saved)
          const readable = editor.textSnapshot().text
          expect(readable).toContain(
            side === 'before' ? 'αlpha \nβeta' : 'αlpha\n βeta',
          )
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

for (const ending of ['\n', '\r\n'])
  for (const [name, body, readable] of [
    ['space entities', 'αlpha&#32;\n&#x20;βeta', 'αlpha \n βeta'],
    ['tab entities', 'αlpha&#9;\n&#x9;βeta', 'αlpha\t\n\tβeta'],
    ['multiple entities', 'αlpha&#32;&#9;\n&#9;&#32;βeta', 'αlpha \t\n\t βeta'],
    ['backslash hard break', 'αlpha\\\nβeta', 'αlpha\nβeta'],
    ['spaces hard break', 'αlpha  \nβeta', 'αlpha\nβeta'],
    ['HTML hard break', 'αlpha<br />\nβeta', 'αlpha\n\nβeta'],
  ])
    test(`edits and reopens authored ${name} (${JSON.stringify(ending)})`, async () => {
      const root = document.body.appendChild(document.createElement('div'))
      const editor = await InkKitEditor.mount(root, {
        changed() {},
        copy() {},
        openLink() {},
      })
      const source = `__Before__ &amp;\n\n${body}\n\nAfter&#33;\n`.replaceAll(
        '\n',
        ending,
      )
      try {
        editor.loadDocument({
          documentId: 'authored-break',
          generation: 1,
          format: 'md',
          text: source,
        })
        expect(editor.snapshot()).toMatchObject({ text: source, dirty: false })
        expect(editor.textSnapshot().text).toContain(readable)
        expect(editor.replace('βeta', 'βetter', 1)).toBe(true)
        const saved = source.replace('βeta', 'βetter')
        expect(editor.snapshot().text).toBe(saved)
        const text = editor.textSnapshot().text
        const copied = await editor.clipboardSnapshot()
        expect(editor.undo()).toBe(true)
        expect(editor.snapshot().text).toBe(source)
        expect(editor.redo()).toBe(true)
        expect(editor.snapshot().text).toBe(saved)
        editor.loadDocument({
          documentId: 'reopened',
          generation: 2,
          format: 'md',
          text: saved,
        })
        expect(editor.snapshot()).toMatchObject({ text: saved, dirty: false })
        expect(editor.textSnapshot().text).toBe(text)
        expect(await editor.clipboardSnapshot()).toMatchObject({
          text: copied.text,
          html: copied.html,
        })
      } finally {
        await editor.destroy()
        root.remove()
      }
    })
