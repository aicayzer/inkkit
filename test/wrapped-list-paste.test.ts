import { expect, test } from 'vitest'
import { InkKitEditor } from '../src/core'

for (const ending of ['\n', '\r\n']) {
  for (const container of ['', '+ ']) {
    for (const marker of ['# ', '- ', '+ ', '* ', '1. ', '1) ', '> ', '```']) {
      test(`continuation ${JSON.stringify([ending, container, marker])}`, async () => {
        const root = document.createElement('div')
        document.body.append(root)
        const errors: Error[] = []
        const editor = await InkKitEditor.mount(root, {
          changed() {},
          copy() {},
          openLink() {},
          error: (error) => errors.push(error),
        })
        const source =
          `__Before__ &amp;\n\n${container}two\n${container ? '  ' : ''}more α\n\nAfter&#33;\n`.replaceAll(
            '\n',
            ending,
          )
        const input = {
          documentId: 'wrapped',
          generation: 1,
          format: 'md' as const,
        }
        try {
          editor.loadDocument({ ...input, text: source })
          const snapshot = editor.textSnapshot()
          const from = snapshot.text.indexOf('more')
          editor.selectTextRange({
            snapshotId: snapshot.snapshotId,
            from,
            to: from,
          })
          expect(editor.insertText(marker, 1)).toBe(true)
          expect(errors).toEqual([])
          const saved = editor.snapshot().text
          expect(saved).toContain('__Before__ &amp;' + ending + ending)
          expect(saved).toContain(ending + ending + 'After&#33;' + ending)
          const readable = editor.textSnapshot().text
          expect(readable).toContain(marker + 'more α')
          expect(editor.undo()).toBe(true)
          expect(editor.snapshot().text).toBe(source)
          expect(editor.redo()).toBe(true)
          expect(editor.snapshot().text).toBe(saved)
          editor.loadDocument({ ...input, generation: 2, text: saved })
          expect(editor.textSnapshot().text).toBe(readable)
          expect(editor.snapshot().text).toBe(saved)
        } finally {
          await editor.destroy()
          root.remove()
        }
      })
    }
  }
  for (const pasted of [
    'x\n\n<!-- c -->',
    '<!-- c -->',
    'x\n\n---',
    'x\n\ny α',
  ]) {
    test(`tight list paste ${JSON.stringify([ending, pasted])}`, async () => {
      const root = document.createElement('div')
      document.body.append(root)
      const errors: Error[] = []
      const editor = await InkKitEditor.mount(root, {
        changed() {},
        copy() {},
        openLink() {},
        error: (error) => errors.push(error),
      })
      const source =
        '__Before__ &amp;\n\n+ a\n+\n+ c\n\nAfter&#33;\n'.replaceAll(
          '\n',
          ending,
        )
      const input = {
        documentId: 'paste',
        generation: 1,
        format: 'md' as const,
      }
      try {
        editor.loadDocument({ ...input, text: source })
        const snapshot = editor.textSnapshot()
        const from = snapshot.text.indexOf('a\n\n') + 2
        editor.selectTextRange({
          snapshotId: snapshot.snapshotId,
          from,
          to: from,
        })
        await editor.paste({ text: pasted, markdown: pasted })
        expect(errors).toEqual([])
        const saved = editor.snapshot().text
        if (pasted.startsWith('x')) expect(saved).toContain('x')
        if (pasted.includes('<!--')) expect(saved).toContain('<!-- c -->')
        if (pasted.includes('---'))
          expect(root.querySelectorAll('hr')).toHaveLength(1)
        if (pasted.includes('y α')) expect(saved).toContain('y α')
        expect(saved).toContain('__Before__ &amp;' + ending + ending)
        expect(saved).toContain(ending + ending + 'After&#33;' + ending)
        const readable = editor.textSnapshot().text
        expect(editor.undo()).toBe(true)
        expect(editor.snapshot().text).toBe(source)
        expect(editor.redo()).toBe(true)
        editor.loadDocument({ ...input, generation: 2, text: saved })
        expect(editor.snapshot().text).toBe(saved)
        expect(editor.textSnapshot().text).toBe(readable)
      } finally {
        await editor.destroy()
        root.remove()
      }
    })
  }
}

for (const comment of ['<!-- c -->', '%%\n  c\n  %%'])
  test(`authored comment-only list retains bytes: ${comment}`, async () => {
    const root = document.createElement('div')
    document.body.append(root)
    const errors: Error[] = []
    const editor = await InkKitEditor.mount(root, {
      changed() {},
      copy() {},
      openLink() {},
      error: (error) => errors.push(error),
    })
    let generation = 0
    try {
      for (const ending of ['\n', '\r\n']) {
        const source = `+ ${comment}\n+ more α\n`.replaceAll('\n', ending)
        editor.loadDocument({
          documentId: 'authored-list',
          generation: ++generation,
          text: source,
          format: 'md',
        })
        expect(editor.snapshot().text).toBe(source)
        const snapshot = editor.textSnapshot()
        const from = snapshot.text.indexOf('more') + 4
        editor.selectTextRange({
          snapshotId: snapshot.snapshotId,
          from,
          to: from,
        })
        editor.insertText('!', generation)
        const saved = editor.snapshot().text
        expect(saved).toBe(source.replace('more', 'more!'))
        const readable = editor.textSnapshot().text
        expect(editor.undo()).toBe(true)
        expect(editor.snapshot().text).toBe(source)
        editor.loadDocument({
          documentId: 'authored-list',
          generation: ++generation,
          text: saved,
          format: 'md',
        })
        expect(editor.snapshot().text).toBe(saved)
        expect(editor.textSnapshot().text).toBe(readable)
        expect(errors).toEqual([])
      }
    } finally {
      await editor.destroy()
      root.remove()
    }
  })
