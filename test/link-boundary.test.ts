import { expect, test } from 'vitest'
import { editorViewCtx } from '@milkdown/kit/core'
import type { Ctx } from '@milkdown/kit/ctx'
import { InkKitEditor } from '../src/index'

for (const explicit of [false, true])
  test(`composition-tagged insertion respects ${explicit ? 'explicit stored' : 'inherited'} link intent`, async () => {
    const root = document.createElement('div')
    document.body.append(root)
    const errors: Error[] = []
    const editor = await InkKitEditor.mount(root, {
      changed() {},
      copy() {},
      openLink() {},
      error: (error) => errors.push(error),
    })
    try {
      const load = (generation: number, text: string) =>
        editor.loadDocument({
          documentId: 'links',
          generation,
          format: 'md',
          text,
        })
      load(1, 'See [docs](docs) tail\n')
      const text = editor.textSnapshot()
      editor.selectTextRange({ snapshotId: text.snapshotId, from: 8, to: 8 })
      const view = (
        editor as unknown as { editor: { ctx: Ctx } }
      ).editor.ctx.get(editorViewCtx)
      if (explicit)
        view.dispatch(
          view.state.tr.addStoredMark(
            view.state.schema.marks.link!.create({ href: 'docs' }),
          ),
        )
      view.dispatch(view.state.tr.insertText('文').setMeta('composition', 1))
      expect(() => editor.insertText('bad', 99)).toThrow()
      editor.insertText('字', 1)
      const expected = explicit
        ? 'See [docs文字](docs) tail\n'
        : 'See [docs](docs)文字 tail\n'
      expect(editor.snapshot().text).toBe(expected)
      expect([...root.querySelectorAll('a')].map((a) => a.textContent)).toEqual(
        [explicit ? 'docs文字' : 'docs'],
      )
      editor.undo()
      expect(editor.snapshot().text).toBe('See [docs](docs) tail\n')
      editor.redo()
      expect(editor.snapshot().text).toBe(expected)
      load(2, expected)
      expect(editor.snapshot().text).toBe(expected)
      expect(errors).toEqual([])
    } finally {
      await editor.destroy()
      root.remove()
    }
  })
