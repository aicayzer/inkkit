import { expect, test } from 'vitest'
import { editorViewCtx } from '@milkdown/kit/core'
import type { Ctx } from '@milkdown/kit/ctx'
import { TextSelection } from '@milkdown/kit/prose/state'
import { undo } from '@milkdown/kit/prose/history'
import {
  InkKitEditor,
  type ImageAdapter,
  type TableCommand,
} from '../src/index'

async function run(
  text: string,
  body: (editor: InkKitEditor, ctx: Ctx) => Promise<void> | void,
  images?: ImageAdapter,
) {
  const root = document.createElement('div')
  document.body.append(root)
  const editor = await InkKitEditor.mount(
    root,
    { changed() {}, stateChanged() {}, copy() {}, openLink() {} },
    { images },
  )
  const ctx = (editor as unknown as { editor: { ctx: Ctx } }).editor.ctx
  try {
    editor.loadDocument({
      documentId: 'table',
      generation: 1,
      format: 'md',
      text,
    })
    const view = ctx.get(editorViewCtx)
    let first = -1
    view.state.doc.descendants((node, position) => {
      if (first < 0 && node.type.name === 'table_cell') first = position + 2
    })
    if (first >= 0)
      view.dispatch(
        view.state.tr.setSelection(TextSelection.create(view.state.doc, first)),
      )
    await body(editor, ctx)
  } finally {
    await editor.destroy()
    root.remove()
  }
}

const sources = [
  '| H | Other |\r\n| :--- | ---: |\r\n| __a__ | a\\|b |\r\n| _b_ | &amp; |\r\n',
  '| H | Other |\n| --- | --- |\n| [first][target] | x[^note] |\n| [second][] | `a\\|b` |\n\n[target]: /target\n[second]: /second\n[^note]: NOTE\n',
  '| H | Other |\n| --- | --- |\n| %%comment%%a | ==highlight== |\n| b | ~~gone~~ |\n',
  '| H | Other |\n| --- | --- |\n| a | [a\\|b][t] |\n| b | [x][t] |\n\n[t]: /target\n',
  '| H | Other |\n| --- | --- |\n| a | [same](/one) |\n| a | [same](/two) |\n',
  '| H | Other |\n| --- | --- |\n| a | &Tab;edge&#x20; |\n| b | &#x20;other&Tab; |\n',
  '| H | Other |\n| --- | --- |\n| a |  |\n| b | x |\n',
]
const commands: TableCommand[] = ['moveRowDown', 'moveColumnRight', 'sortRows']
for (const [index, text] of sources.entries())
  for (const command of commands)
    test(`table ${command} reconstructs escaped and authored content ${index}`, () =>
      run(text, async (editor, ctx) => {
        const view = ctx.get(editorViewCtx)
        const changed = editor.table(
          command,
          command === 'sortRows' ? { order: 'descending' } : undefined,
        )
        if (!changed) {
          expect(command).toBe('sortRows')
          expect(editor.snapshot().text).toBe(text)
          return
        }
        const saved = editor.snapshot().text
        const semanticJSON = () =>
          JSON.parse(
            JSON.stringify(view.state.doc.toJSON(), (key, value) =>
              key === 'marker' ? undefined : value,
            ),
          )
        const moved = semanticJSON()
        const copied = await editor.clipboardSnapshot()
        expect(copied.markdown).toBe(saved)
        if (index === 1) {
          expect(copied.text).toContain('first')
          expect(copied.markdown).toContain('[target]: /target')
          expect(copied.markdown).toContain('[^note]: NOTE')
        }
        if (index === 2) {
          expect(copied.text).not.toContain('comment')
          expect(copied.markdown).toContain('%%comment%%')
        }
        expect(undo(view.state, view.dispatch)).toBe(true)
        expect(editor.snapshot().text).toBe(text)
        editor.loadDocument({
          documentId: 'table',
          generation: 2,
          format: 'md',
          text: saved,
        })
        expect(editor.snapshot().text).toBe(saved)
        expect(semanticJSON()).toEqual(moved)
      }))

test('editing a table text leaf escapes newly inserted pipes and retains its cell boundaries', () =>
  run('| H | Other |\n| --- | --- |\n| a | b |\n', (editor, ctx) => {
    const view = ctx.get(editorViewCtx)
    view.dispatch(view.state.tr.insertText('x|y'))
    const saved = editor.snapshot().text
    expect(saved).toContain('x\\|ya')
    editor.loadDocument({
      documentId: 'table',
      generation: 2,
      format: 'md',
      text: saved,
    })
    const table = view.state.doc.firstChild!
    expect(table.child(1).childCount).toBe(2)
    expect(table.child(1).child(0).textContent).toBe('x|ya')
  }))

test('movement retains distinct managed image references with identical alt text', () => {
  const text =
    '| H | Image |\n| --- | --- |\n| a | ![same](image:one) |\n| a | ![same](image:two) |\n'
  const images: ImageAdapter = {
    presentation: () => ({ url: 'data:image/png;base64,AA==' }),
    importImage: async () => ({ reference: 'image:imported' }),
    exportImage: async () => ({
      bytes: new Uint8Array([1]),
      mimeType: 'image/png',
    }),
  }
  return run(
    text,
    (editor, ctx) => {
      const view = ctx.get(editorViewCtx)
      expect(editor.table('moveRowDown')).toBe(true)
      const saved = editor.snapshot().text
      expect(saved.indexOf('image:two')).toBeLessThan(
        saved.indexOf('image:one'),
      )
      const moved = view.state.doc.toJSON()
      expect(undo(view.state, view.dispatch)).toBe(true)
      expect(editor.snapshot().text).toBe(text)
      editor.loadDocument({
        documentId: 'table',
        generation: 2,
        format: 'md',
        text: saved,
      })
      expect(view.state.doc.toJSON()).toEqual(moved)
    },
    images,
  )
})

test.each([
  '<table><!--PRIVATE--><tr><th>head</th></tr><tr><td>cell</td></tr></table>',
  '<table><tbody><!--PRIVATE--><tr><th>head</th></tr><tr><td>cell</td></tr></tbody></table>',
  '<table><tr><!--PRIVATE--><th>head</th></tr><tr><td>cell</td></tr></table>',
  '<table><tr><th>head<!--PRIVATE--></th></tr><tr><td>cell</td></tr></table>',
  '<table>\n<!--\nPRIVATE\n-->\n<tr><th>head</th></tr><tr><td>cell</td></tr>\n</table>',
  '<table><caption>CAPTION</caption><colgroup><col span="2"></colgroup><tr><th>head</th><th>other</th></tr><tr><td>cell</td><td>second</td></tr></table>',
  '<table><tr><th colspan="2">merged</th></tr><tr><td>first</td><td>second</td></tr></table>',
  '<table><tr><th>head</th></tr><tr><td><table><tr><td>nested</td></tr></table></td></tr></table>',
  '<table><tr><th>head</th></tr><tr><td><custom>unsupported</custom></td></tr></table>',
  '<table><tr><th>head</th></tr><tr><td><span><p>first</p><p>second</p></span></td></tr></table>',
  '<table><tr><th>head</th></tr><tr><td><strong><p>first</p><p>second</p></strong></td></tr></table>',
  '<table><tr><th>head</th></tr><tr><td>before<p>body</p>after</td></tr></table>',
  '<table><tr><th>head</th></tr><tr><td>first<br>second</td></tr></table>',
  '<table><tr><th>head</th></tr><tr><td><br></td></tr></table>',
  '<table><tr><th>first<br>second</th></tr><tr><td>cell</td></tr></table>',
  '<table><tr><th>head</th></tr><tr><td><p>first<br>second</p></td></tr></table>',
  '<table><caption><!--PRIVATE-->CAPTION</caption><tr><th>head</th></tr><tr><td><img src="image:opaque" alt="IMAGE"></td></tr></table>',
])(
  'mixed clipboard preserves unsupported table source and private comments: %s',
  (table) =>
    run('', async (editor, ctx) => {
      const html = `<p>Before</p>${table}<p>After</p>`
      const template = document.createElement('template')
      template.innerHTML = table
      const captured = template.content.querySelector('table')!.outerHTML
      await editor.paste({ text: 'Before\nhead\ncell\nAfter', html })
      const view = ctx.get(editorViewCtx)
      const saved = editor.snapshot().text
      const pasted = view.state.doc.toJSON()
      expect(saved).toContain(captured)
      expect(view.state.doc.firstChild!.textContent).toBe('Before')
      expect(view.state.doc.lastChild!.textContent).toBe('After')
      const copy = await editor.clipboardSnapshot()
      expect(copy.markdown).toBe(saved)
      expect(copy.text).not.toContain('PRIVATE')
      expect(copy.html).not.toContain('PRIVATE')
      editor.setCommentsVisible(true)
      expect((await editor.clipboardSnapshot()).text).not.toContain('PRIVATE')
      expect(editor.snapshot().text).toBe(saved)
      expect(undo(view.state, view.dispatch)).toBe(true)
      expect(editor.snapshot().text).toBe('')
      editor.loadDocument({
        documentId: 'table',
        generation: 2,
        format: 'md',
        text: saved,
      })
      expect(editor.snapshot().text).toBe(saved)
      expect(view.state.doc.toJSON()).toEqual(pasted)
    }),
)
