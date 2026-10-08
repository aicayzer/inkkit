import { expect, test } from 'vitest'
import type { Ctx } from '@milkdown/kit/ctx'
import { undo } from '@milkdown/kit/prose/history'
import { InkKitEditor, type ImageAdapter } from '../src/index'
import { editorViewCtx, parserCtx } from '@milkdown/kit/core'
import { TextSelection } from '@milkdown/kit/prose/state'
import { Fragment } from '@milkdown/kit/prose/model'
import { withEditor } from './harness'
import { serialize } from '../src/dialect'
import { clipboardContent, clipboardText } from '../src/clipboard'
import {
  commentSelectionContent,
  isComment,
  literalCommentSpans,
  setCommentVisibility,
  shareableFragment,
} from '../src/comments'
import { referenceMetadata, selectionContent } from '../src/reference-clipboard'

test('comment scanning respects code, escapes, quoted HTML attributes and incomplete syntax', () => {
  const source =
    'Visible %%secret%% <!--html--> `%%code%% <!--code-->` \\%%escaped%%\n\n```md\n%%fenced%% <!--fenced-->\n```\n\n<div title="<!--attribute-->">Visible <!--inside--></div>\n\n%%unfinished\n\n<!--unfinished'
  expect(literalCommentSpans(source).map((span) => span.value)).toEqual([
    'secret',
    'html',
    'inside',
  ])
})

test('inline and block comment nodes retain source, edit safely and reopen', async () => {
  const source =
    'Before <!--secret <script>unsafe()</script>--> and %%note%% after.\n\n<!--block\nbody-->\n\n%%\n# private heading\n\n**private**\n%%\n'
  await withEditor(source, (editor) => {
    const view = editor.ctx.get(editorViewCtx)
    const found: Array<{ position: number; value: string; block: boolean }> = []
    view.state.doc.descendants((node, position) => {
      if (isComment(node)) {
        found.push({ position, value: node.textContent, block: node.isBlock })
        return false
      }
    })
    expect(found.map((node) => node.block)).toEqual([false, false, true, true])
    expect(found.at(-1)?.value).toBe('# private heading\n\n**private**')
    expect(view.dom.querySelector('script')).toBeNull()
    expect(view.dom.getAttribute('data-inkkit-comments-visible')).toBe('false')
    setCommentVisibility(view, true)
    expect(view.dom.getAttribute('data-inkkit-comments-visible')).toBe('true')
    view.dispatch(
      view.state.tr.insertText(
        'EDIT',
        found[0]!.position + 1,
        found[0]!.position + 7,
      ),
    )
    const markdown = serialize(editor.ctx)
    expect(markdown).toContain('<!--EDIT <script>unsafe()</script>-->')
    expect(editor.ctx.get(parserCtx)(markdown).eq(view.state.doc)).toBe(true)
    expect(
      shareableFragment(view.state.doc.content).textBetween(
        0,
        shareableFragment(view.state.doc.content).size,
      ),
    ).toBe('Before  and  after.')
  })
})

test('comments remain editable inside unsupported literal Markdown while code stays literal', async () => {
  const source =
    '<div title="<!--attribute-->">Visible <!--private--> tail</div>\n\n[unresolved][missing] %%hidden%% `%%code%%`\n\n> [!UNSUPPORTED]\n> visible %%callout secret%%\n\n---\n'
  await withEditor(source, (editor) => {
    const view = editor.ctx.get(editorViewCtx)
    const found: Array<{ value: string; position: number }> = []
    view.state.doc.descendants((node, position) => {
      if (isComment(node)) {
        found.push({ value: node.textContent, position })
        return false
      }
    })
    expect(found.map((node) => node.value)).toEqual([
      'private',
      'hidden',
      'callout secret',
    ])
    view.dispatch(
      view.state.tr.insertText(
        'updated',
        found[1]!.position + 1,
        found[1]!.position + 7,
      ),
    )
    const markdown = serialize(editor.ctx)
    expect(markdown).toContain('%%updated%% `%%code%%`')
    expect(editor.ctx.get(parserCtx)(markdown).eq(view.state.doc)).toBe(true)
    const text = clipboardText(shareableFragment(view.state.doc.content))
    expect(text).not.toContain('private')
    expect(text).not.toContain('updated')
    expect(text).not.toContain('callout secret')
    expect(text).toContain('%%code%%')
    expect(text).toContain('<!--attribute-->')
  })
})

test('ordinary copy removes comments from recursively required definitions and metadata', async () => {
  await withEditor(
    'Public[^a] <!--private-->\n\n[^a]: Definition %%secret%% [URL][label].\n\n[label]: /target\n',
    (editor) => {
      const { doc } = editor.ctx.get(editorViewCtx).state
      const selected = Fragment.from(doc.firstChild!)
      const closed = selectionContent(doc, selected)
      expect(serialize(editor.ctx, doc.type.create(null, closed))).toContain(
        'secret',
      )
      const filtered = shareableFragment(closed)
      expect(clipboardText(filtered)).not.toMatch(/private|secret/)
      expect(clipboardContent(filtered, doc.type.schema).html).not.toMatch(
        /private|secret|inkkit-comment/,
      )
      const metadata = referenceMetadata(
        editor.ctx,
        doc,
        shareableFragment(selected),
      )!
      expect(metadata).toContain('[^a]')
      expect(metadata).toContain('[label]: /target')
      expect(metadata).not.toMatch(/private|secret/)
    },
  )
})

test('partial author-comment selections keep explicit Markdown wrapper but ordinary copy is empty', async () => {
  await withEditor('Visible <!--secret--> after\n', (editor) => {
    const view = editor.ctx.get(editorViewCtx)
    let position = 0
    view.state.doc.descendants((node, pos) => {
      if (isComment(node)) position = pos
    })
    view.dispatch(
      view.state.tr.setSelection(
        TextSelection.create(view.state.doc, position + 2, position + 5),
      ),
    )
    const { selection, doc } = view.state
    const selected = commentSelectionContent(
      doc,
      selection.from,
      selection.to,
      selection.content().content,
    )
    expect(selected.firstChild?.textContent).toBe('ecr')
    expect(selected.firstChild?.type.name).toBe('comment_inline')
    expect(shareableFragment(selected).size).toBe(0)
    expect(clipboardText(shareableFragment(selected))).toBe('')
  })
})

test('empty comments and multiline inline comments are safe editable nodes', async () => {
  const source = 'A <!----> B %%line one\nline two%% C\n\n%%%%\n\n%%\n%%\n'
  await withEditor(source, (editor) => {
    const view = editor.ctx.get(editorViewCtx)
    const values: string[] = []
    view.state.doc.descendants((node) => {
      if (isComment(node)) {
        values.push(node.textContent)
        return false
      }
    })
    expect(values).toEqual(['', 'line one\nline two', '', ''])
    expect(
      editor.ctx.get(parserCtx)(serialize(editor.ctx)).eq(view.state.doc),
    ).toBe(true)
    expect(clipboardText(shareableFragment(view.state.doc.content))).toBe(
      'A  B  C',
    )
  })
})

async function withFacade(
  run: (editor: InkKitEditor, ctx: Ctx) => Promise<void> | void,
  images?: ImageAdapter,
) {
  const root = document.createElement('div')
  document.body.append(root)
  const editor = await InkKitEditor.mount(
    root,
    {
      changed() {},
      stateChanged() {},
      copy() {},
      openLink() {},
    },
    { images },
  )
  const ctx = (editor as unknown as { editor: { ctx: Ctx } }).editor.ctx
  try {
    await run(editor, ctx)
  } finally {
    await editor.destroy()
    root.remove()
  }
}

test('facade snapshots retain comments and surrounding spelling, visibility is presentation only, undo restores exact source', async () => {
  const source =
    '__bold__ &amp; Before <!--secret--> and %%author%% after.\r\n\r\n<!--block\r\nbody-->\r\n\r\n%%\r\nprivate\r\n\r\n# heading\r\n%%\r\n'
  await withFacade(async (editor, ctx) => {
    editor.loadDocument({
      documentId: 'comments',
      generation: 1,
      format: 'md',
      text: source,
    })
    const baseline = editor.snapshot()
    editor.setCommentsVisible(true)
    expect(editor.snapshot()).toEqual(baseline)
    editor.setCommentsVisible(false)
    expect(editor.snapshot()).toEqual(baseline)
    const view = ctx.get(editorViewCtx)
    let position = 0
    view.state.doc.descendants((node, pos) => {
      if (isComment(node) && node.textContent === 'author') position = pos
    })
    view.dispatch(
      view.state.tr.insertText('revised', position + 1, position + 7),
    )
    const changed = editor.snapshot()
    expect(changed.text).toContain(
      '__bold__ &amp; Before <!--secret--> and %%revised%% after.',
    )
    expect(changed.text).toContain('<!--block\r\nbody-->')
    expect(changed.dirty).toBe(true)
    const copied = await editor.clipboardSnapshot()
    expect(copied.markdown).toBe(changed.text)
    expect(copied.text).not.toMatch(/secret|revised|private|heading|body/)
    expect(copied.html).not.toMatch(
      /secret|revised|private|heading|body|inkkit-comment/,
    )
    undo(view.state, view.dispatch)
    expect(editor.snapshot().text).toBe(source)
    expect(editor.snapshot().dirty).toBe(false)
    editor.loadDocument({
      documentId: 'reopened',
      generation: 2,
      format: 'md',
      text: changed.text,
    })
    expect(editor.snapshot().text).toBe(changed.text)
  })
})

test('partial comment selection exports Markdown only, frontmatter and TXT punctuation stay literal', async () => {
  await withFacade(async (editor, ctx) => {
    const source =
      '---\nquoted: "%%yaml%% <!--yaml-->"\n---\n\nVisible <!--secret--> after\n'
    editor.loadDocument({
      documentId: 'partial',
      generation: 1,
      format: 'md',
      text: source,
    })
    const view = ctx.get(editorViewCtx)
    let position = 0
    view.state.doc.descendants((node, pos) => {
      if (isComment(node)) position = pos
    })
    view.dispatch(
      view.state.tr.setSelection(
        TextSelection.create(view.state.doc, position + 2, position + 5),
      ),
    )
    const selected = await editor.clipboardSnapshot(false)
    expect(selected.markdown.trim()).toBe('<!--ecr-->')
    expect(selected.text).toBe('')
    expect(selected.html).not.toContain('ecr')
    expect((await editor.clipboardSnapshot()).text).toContain(
      '%%yaml%% <!--yaml-->',
    )
    editor.loadDocument({
      documentId: 'txt',
      generation: 2,
      format: 'txt',
      text: '%%plain%% <!--plain-->',
    })
    expect(editor.snapshot().text).toBe('%%plain%% <!--plain-->')
    expect((await editor.clipboardSnapshot()).text).toBe(
      '%%plain%% <!--plain-->',
    )
  })
})

test('multiline author comments keep quote gutters in unsupported callout source', async () => {
  const source =
    '> [!UNSUPPORTED]\n> %%\n> private\n>\n> hidden\n> %%\n> visible\n'
  await withFacade((editor, ctx) => {
    editor.loadDocument({
      documentId: 'quoted',
      generation: 1,
      format: 'md',
      text: source,
    })
    const view = ctx.get(editorViewCtx)
    expect(editor.snapshot().text).toBe(source)
    expect(editor.snapshot().dirty).toBe(false)
    const values: string[] = []
    view.state.doc.descendants((node) => {
      if (isComment(node)) values.push(node.textContent)
    })
    expect(values).toHaveLength(1)
    expect(values).toEqual(['private\n\nhidden'])
    expect(ctx.get(parserCtx)(serialize(ctx)).eq(view.state.doc)).toBe(true)
    view.dispatch(
      view.state.tr.insertText('!', view.state.doc.content.size - 1),
    )
    expect(editor.snapshot().text).toBe(source.replace('visible', 'visible!'))
  })
})

test('ordinary HTML and its Markdown metadata cannot leak comment provenance in shared links', async () => {
  const sources = [
    '[Visible <!--REF_SECRET-->][Label]\n\n[Label]: https://example.com\n',
    '[Visible %%REF_SECRET%%][Label]\n\n[Label]: https://example.com\n',
    '[Visible <!--REF_SECRET-->][]\n\n[Visible <!--REF_SECRET-->]: https://example.com\n',
    '[Visible %%REF_SECRET%%][]\n\n[Visible %%REF_SECRET%%]: https://example.com\n',
    'Public[^note]\n\n[^note]: [Visible %%REF_SECRET%%][Label]\n\n[Label]: https://example.com\n',
  ]
  for (const source of sources) {
    await withFacade(async (editor, ctx) => {
      editor.loadDocument({
        documentId: 'provenance',
        generation: 1,
        format: 'md',
        text: source,
      })
      const copied = await editor.clipboardSnapshot()
      expect(copied.markdown).toBe(source)
      expect(copied.text).not.toContain('REF_SECRET')
      expect(copied.html).not.toContain('REF_SECRET')
      const dom = document.createElement('div')
      dom.innerHTML = copied.html
      expect(dom.querySelector('a')?.getAttribute('href')).toBe(
        'https://example.com',
      )
      const metadata = dom
        .querySelector('[data-inkkit-markdown]')
        ?.getAttribute('data-inkkit-markdown')
      expect(metadata ?? '').not.toContain('REF_SECRET')
      expect(editor.snapshot().text).toBe(source)
      expect(ctx.get(editorViewCtx).state.doc.textContent).toContain(
        'REF_SECRET',
      )
    })
  }
})

test('shared links retain safe entity and escape provenance from 0.0.2', async () => {
  for (const label of ['A&amp;B', 'A\\*B']) {
    const source = `[${label}][]\n\n[${label}]: https://example.com/target\n`
    await withFacade(async (editor) => {
      editor.loadDocument({
        documentId: 'safe-label',
        generation: 1,
        format: 'md',
        text: source,
      })
      const copied = await editor.clipboardSnapshot()
      editor.loadDocument({
        documentId: 'paste',
        generation: 2,
        format: 'md',
        text: '',
      })
      await editor.paste({ html: copied.html, text: copied.text })
      expect(editor.snapshot().text).toContain(`[${label}][]`)
      expect(editor.snapshot().text).toContain(
        `[${label}]: https://example.com/target`,
      )
    })
  }
})

test('ordinary output preserves images and footnote atoms adjacent to comments', async () => {
  const images: ImageAdapter = {
    presentation: (reference) => ({ url: `private://${reference}` }),
    importImage: async () => ({ reference: 'image.png' }),
    exportImage: async () => ({
      bytes: new Uint8Array([1, 2, 3]),
      mimeType: 'image/png',
    }),
  }
  await withFacade(async (editor) => {
    const source =
      '![Photo](image.png)<!--PRIVATE-->\n\n[^a]%%PRIVATE%%\n\n[^a]: %%PRIVATE%%\n'
    editor.loadDocument({
      documentId: 'atoms',
      generation: 1,
      format: 'md',
      text: source,
    })
    const copied = await editor.clipboardSnapshot()
    expect(copied.images).toHaveLength(1)
    expect(copied.images[0]?.reference).toBe('image.png')
    expect(copied.html).toContain('data-inkkit-image-slot="0"')
    expect(copied.html).toContain('data-inkkit-footnote-reference="a"')
    expect(copied.text).toContain('Photo')
    expect(copied.text).toContain('[a]')
    expect(copied.html).not.toContain('PRIVATE')
    expect(copied.text).not.toContain('PRIVATE')
    expect(copied.markdown).toBe(source)
  }, images)
})

test('comment-only table cells preserve column structure and nested lists retain surviving content', async () => {
  await withEditor(
    '| <!--HIDDEN--> | Public |\n| --- | --- |\n| %%HIDDEN%% | Other |\n\n- %%HIDDEN%%\n  - Visible\n',
    (editor) => {
      const view = editor.ctx.get(editorViewCtx)
      const shared = shareableFragment(view.state.doc.content)
      const table = shared.firstChild!
      expect(table.type.name).toBe('table')
      table.forEach((row) => {
        expect(row.childCount).toBe(2)
        row.forEach((cell) =>
          expect(cell.firstChild?.type.name).toBe('paragraph'),
        )
      })
      const list = shared.lastChild!
      expect(list.firstChild?.firstChild?.type.name).toBe('paragraph')
      expect(clipboardText(shared)).toContain('Visible')
      expect(clipboardText(shared)).not.toContain('HIDDEN')
      expect(clipboardContent(shared, view.state.schema).html).toContain(
        'Other',
      )
      expect(editor.ctx.get(parserCtx)(serialize(editor.ctx)).toJSON()).toEqual(
        view.state.doc.toJSON(),
      )
    },
  )
})

test('explicit plain-text paste keeps comment delimiters literal in Markdown', async () => {
  for (const source of ['', 'Before ']) {
    await withFacade((editor, ctx) => {
      editor.loadDocument({
        documentId: 'literal-paste',
        generation: 1,
        format: 'md',
        text: source,
      })
      const view = ctx.get(editorViewCtx)
      view.dispatch(
        view.state.tr.setSelection(
          TextSelection.create(view.state.doc, view.state.doc.content.size - 1),
        ),
      )
      editor.pasteAsPlainText('%%literal%%')
      const saved = editor.snapshot().text
      expect(ctx.get(parserCtx)(saved).eq(view.state.doc)).toBe(true)
      expect(
        shareableFragment(view.state.doc.content).textBetween(
          0,
          view.state.doc.content.size,
        ),
      ).toContain('%%literal%%')
      expect(saved).toContain('\\%')
    })
  }
})
