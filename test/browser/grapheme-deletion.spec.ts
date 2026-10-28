import { expect, test } from '@playwright/test'

const moduleUrl = `/@fs${process.cwd()}/src/core.ts`

for (const fixture of [
  { format: 'md', key: 'Backspace', cluster: '👩🏽‍💻', interior: 2 },
  { format: 'txt', key: 'Delete', cluster: '🇬🇧', interior: 2 },
] as const) {
  test(`${fixture.format} buffered ${fixture.key} removes an interior grapheme and preserves exact source`, async ({
    page,
  }) => {
    await page.goto('/')
    await page.waitForFunction(() => Boolean(window.inkkitPlayground))
    const result = await page.evaluate(
      async ({ moduleUrl, fixture }) => {
        const { InkKitEditor } = (await import(
          moduleUrl
        )) as typeof import('../../src/core')
        const root = document.createElement('div')
        document.body.append(root)
        const editor = await InkKitEditor.mount(root, { changed() {} })
        try {
          const text = `\uFEFFpre\r\nA${fixture.cluster}B\nkeep\rfinal`
          editor.loadDocument({
            documentId: 'graphemes',
            generation: 1,
            format: fixture.format,
            text,
          })
          if (fixture.format === 'md') editor.setEditingMode('source')
          const snapshot = editor.textSnapshot()
          const from = snapshot.text.indexOf(fixture.cluster)
          editor.selectTextRange({
            snapshotId: snapshot.snapshotId,
            from: from + fixture.interior,
            to: from + fixture.interior,
          })
          const handled = editor.keyDown({ key: fixture.key }, 1)
          const after = editor.snapshot()
          const caret = editor.textSnapshot().selection
          const undone = editor.undo()
          const undoText = editor.snapshot().text
          const undoSelection = editor.textSnapshot().selection
          const redone = editor.redo()
          const saved = editor.snapshot()
          const redoSelection = editor.textSnapshot().selection
          editor.loadDocument({ ...saved, generation: 2 })
          return {
            text,
            from,
            handled,
            after,
            caret,
            undone,
            undoText,
            undoSelection,
            redone,
            saved,
            redoSelection,
            reopened: editor.snapshot(),
          }
        } finally {
          await editor.destroy()
          root.remove()
        }
      },
      { moduleUrl, fixture },
    )
    const expected = '\uFEFFpre\r\nAB\nkeep\rfinal'
    expect(result.handled).toBe(true)
    expect(result.after).toMatchObject({
      text: expected,
      revision: 1,
      dirty: true,
    })
    expect(result.caret).toMatchObject({ from: result.from, to: result.from })
    expect(result.undone).toBe(true)
    expect(result.undoText).toBe(result.text)
    expect(result.undoSelection).toMatchObject({
      from: result.from,
      to: result.from + fixture.cluster.length,
    })
    expect(result.redone).toBe(true)
    expect(result.saved.text).toBe(expected)
    expect(result.redoSelection).toMatchObject({
      from: result.from,
      to: result.from,
    })
    expect(result.reopened).toMatchObject({ text: expected, dirty: false })
  })
}
