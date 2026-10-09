import { expect, test } from 'vitest'
import {
  Editor,
  defaultValueCtx,
  rootCtx,
  editorViewCtx,
  remarkCtx,
  remarkStringifyOptionsCtx,
} from '@milkdown/kit/core'
import { history } from '@milkdown/kit/plugin/history'
import { undo, redo, closeHistory } from '@milkdown/kit/prose/history'
import { TextSelection } from '@milkdown/kit/prose/state'
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import { createDialect, serialize, stringifyOptions } from '../src/dialect'
import {
  fileReference,
  parseLinkedSyntax,
  namedFileMarkdown,
  wikiMarkdown,
  wikiReference,
} from '../src/linked-syntax'
import { Preservation } from '../src/preserve'
import { InkKitEditor } from '../src/index'

async function run(
  source: string,
  callback: (editor: Editor, preservation: Preservation) => void,
  wiki = true,
  files = true,
) {
  const root = document.createElement('div')
  document.body.append(root)
  const editor = await Editor.make()
    .config((ctx) => {
      ctx.set(rootCtx, root)
      ctx.set(defaultValueCtx, source)
      ctx.set(remarkStringifyOptionsCtx, stringifyOptions)
    })
    .use(createDialect(files, wiki, files))
    .use(history)
    .create()
  try {
    callback(editor, new Preservation(editor.ctx, source))
  } finally {
    await editor.destroy()
    root.remove()
  }
}
function nodes(
  editor: Editor,
  type: string,
): { node: ProseNode; position: number }[] {
  const matches: { node: ProseNode; position: number }[] = []
  editor.ctx.get(editorViewCtx).state.doc.descendants((node, position) => {
    if (node.type.name === type) matches.push({ node, position })
  })
  return matches
}

test.each([
  ['[[Note]]', 'Note', null, 'Note'],
  ['[[Note#Heading|Readable alias]]', 'Note', 'Heading', 'Readable alias'],
  ['[[#Local heading]]', '', 'Local heading', '#Local heading'],
  [
    String.raw`[[A\[one\]\|two\#three\\four#Frag\#literal|Alias\|text]]`,
    'A[one]|two#three\\four',
    'Frag#literal',
    'Alias|text',
  ],
])(
  'bounded wiki parser preserves escaped spelling %s',
  (raw, target, fragment, label) => {
    expect(parseLinkedSyntax(raw!)).toMatchObject({
      raw,
      target,
      fragment,
      label,
      embed: false,
    })
  },
)

test.each([
  '[[ ]]',
  '[[Note|]]',
  '[[Note#]]',
  '[[Note#^block]]',
  '[[ ^block]]',
  '[[Note|alias|extra]]',
  '[[Note#one#two]]',
  '[[nested [[link]]]]',
  '[[a\nb]]',
  String.raw`[[bad\q]]`,
  '![[Note#^block]]',
  '![[file|alias]]',
  '![[file|0]]',
  '![[file|100000]]',
])('unsupported/untidy syntax stays outside supported grammar: %s', (raw) => {
  expect(parseLinkedSyntax(raw)).toBeUndefined()
})

test('wiki atoms retain exact source through adjacent edit, source reopen and history', () =>
  run('Before [[Note#Heading|Alias]] after.\r\n', (editor, preservation) => {
    const view = editor.ctx.get(editorViewCtx)
    const wiki = nodes(editor, 'inkkit_wiki_link')[0]!.node
    expect(wikiReference(wiki)).toEqual({
      target: 'Note',
      fragment: 'Heading',
      label: 'Alias',
    })
    expect(preservation.serialize(view.state.doc)).toBe(
      'Before [[Note#Heading|Alias]] after.\r\n',
    )
    view.dispatch(
      closeHistory(
        view.state.tr.insertText('!', view.state.doc.content.size - 1),
      ),
    )
    view.dispatch(closeHistory(view.state.tr).setMeta('addToHistory', false))
    expect(preservation.serialize(view.state.doc)).toBe(
      'Before [[Note#Heading|Alias]] after.!\r\n',
    )
    expect(undo(view.state, view.dispatch)).toBe(true)
    expect(preservation.serialize(view.state.doc)).toBe(
      'Before [[Note#Heading|Alias]] after.\r\n',
    )
    expect(redo(view.state, view.dispatch)).toBe(true)
    const reopened = editor.ctx
      .get(remarkCtx)
      .parse(preservation.serialize(view.state.doc))
    expect(JSON.stringify(reopened)).toContain('inkkitWikiLink')
  }))

test.each([false, true])(
  'disabled optional syntax remains exact even beside enabled unrelated features (%s)',
  (wiki) =>
    run(
      '[[Note#Heading|Alias]] ![[image.png|400]]\r\n',
      (editor, preservation) => {
        expect(nodes(editor, 'image')).toHaveLength(0)
        expect(
          preservation.serialize(editor.ctx.get(editorViewCtx).state.doc),
        ).toBe('[[Note#Heading|Alias]] ![[image.png|400]]\r\n')
      },
      wiki,
      false,
    ),
)

test('escaped openers and code never become wiki atoms; unsupported block references remain literal', () =>
  run(
    String.raw`\[[Escaped]]` + '\n\n`[[Code]]`\n\n[[Note#^block]]\n',
    (editor, preservation) => {
      expect(nodes(editor, 'inkkit_wiki_link')).toHaveLength(0)
      expect(
        preservation.serialize(editor.ctx.get(editorViewCtx).state.doc),
      ).toBe(String.raw`\[[Escaped]]` + '\n\n`[[Code]]`\n\n[[Note#^block]]\n')
    },
  ))

test('named and path embeds share opaque image nodes while retaining their distinct reference forms', () =>
  run(
    String.raw`![[folder/A\]B.png#page=2|00400]]` +
      '\n\n![Alt|320](opaque/path#frag)\n',
    (editor, preservation) => {
      const images = nodes(editor, 'image')
      expect(images).toHaveLength(2)
      const named = images[0]!.node,
        path = images[1]!.node
      expect(fileReference(named)).toEqual({
        reference: 'folder/A]B.png#page=2',
        kind: 'wiki',
        fragment: 'page=2',
        label: 'folder/A]B.png#page=2',
        width: 400,
      })
      expect(fileReference(path)).toEqual({
        reference: 'opaque/path#frag',
        kind: 'path',
        fragment: 'frag',
        label: 'Alt',
        width: 320,
      })
      expect(namedFileMarkdown(named)).toBe(
        String.raw`![[folder/A\]B.png#page=2|00400]]`,
      )
      expect(
        preservation.serialize(editor.ctx.get(editorViewCtx).state.doc),
      ).toBe(
        String.raw`![[folder/A\]B.png#page=2|00400]]` +
          '\n\n![Alt|320](opaque/path#frag)\n',
      )
    },
  ))

test('named resize changes only width spelling, preserves fragment and has coherent undo', () =>
  run(
    String.raw`Before ![[A\|B.png#page=2|00400]] after.` + '\r\n',
    (editor, preservation) => {
      const view = editor.ctx.get(editorViewCtx),
        named = nodes(editor, 'image')[0]!
      view.dispatch(
        closeHistory(
          view.state.tr.setNodeMarkup(named.position, undefined, {
            ...named.node.attrs,
            alt: 'A|B.png#page=2|380',
          }),
        ),
      )
      view.dispatch(closeHistory(view.state.tr).setMeta('addToHistory', false))
      expect(preservation.serialize(view.state.doc)).toBe(
        String.raw`Before ![[A\|B.png#page=2|380]] after.` + '\r\n',
      )
      expect(undo(view.state, view.dispatch)).toBe(true)
      expect(preservation.serialize(view.state.doc)).toBe(
        String.raw`Before ![[A\|B.png#page=2|00400]] after.` + '\r\n',
      )
    },
  ))

test('a named reference ending in an escaped numeric pipe has no accidental width', () =>
  run(String.raw`![[file\|400]]` + '\n', (editor) => {
    const node = nodes(editor, 'image')[0]!.node
    expect(fileReference(node)).toEqual({
      reference: 'file|400',
      kind: 'wiki',
      label: 'file|400',
    })
    expect(namedFileMarkdown(node)).toBe(String.raw`![[file\|400]]`)
  }))

test('GFM escaped separator pipes parse as aliases/sizes and copy to valid standalone Markdown', () => {
  const source =
    '| Wiki | File |\r\n| --- | --- |\r\n| [[Note\\|Alias]] | ![[photo.png\\|400]] |\r\n'
  return run(source, (editor, preservation) => {
    const wiki = nodes(editor, 'inkkit_wiki_link')[0]!.node
    const image = nodes(editor, 'image')[0]!.node
    expect(wikiReference(wiki)).toEqual({ target: 'Note', label: 'Alias' })
    expect(wikiMarkdown(wiki)).toBe('[[Note|Alias]]')
    expect(wikiMarkdown(wiki, true)).toBe('[[Note\\|Alias]]')
    expect(namedFileMarkdown(image)).toBe('![[photo.png|400]]')
    expect(fileReference(image).width).toBe(400)
    expect(
      preservation.serialize(editor.ctx.get(editorViewCtx).state.doc),
    ).toBe(source)
    expect(serialize(editor.ctx)).toContain('[[Note\\|Alias]]')
  })
})

test('typing adjacent to a wiki atom keeps its label/source opaque', () =>
  run('[[Note|Alias]] next\n', (editor, preservation) => {
    const view = editor.ctx.get(editorViewCtx),
      wiki = nodes(editor, 'inkkit_wiki_link')[0]!
    view.dispatch(
      view.state.tr
        .setSelection(
          TextSelection.create(
            view.state.doc,
            wiki.position + wiki.node.nodeSize,
          ),
        )
        .insertText('!'),
    )
    expect(preservation.serialize(view.state.doc)).toBe(
      '[[Note|Alias]]! next\n',
    )
  }))

test('table literal pipes use a separate escaping layer from alias and sizing separators', () => {
  const source =
    String.raw`| Wiki | File |` +
    '\n| --- | --- |\n' +
    String.raw`| [[A\\\|B\|Alias]] | ![[A\\\|B.png\|400]] |` +
    '\n'
  return run(source, (editor, preservation) => {
    const wiki = nodes(editor, 'inkkit_wiki_link')[0]!.node
    const image = nodes(editor, 'image')[0]!.node
    expect(wikiReference(wiki)).toEqual({ target: 'A|B', label: 'Alias' })
    expect(wikiMarkdown(wiki)).toBe(String.raw`[[A\|B|Alias]]`)
    expect(wikiMarkdown(wiki, true)).toBe(String.raw`[[A\\\|B\|Alias]]`)
    expect(fileReference(image)).toMatchObject({
      reference: 'A|B.png',
      width: 400,
    })
    expect(namedFileMarkdown(image)).toBe(String.raw`![[A\|B.png|400]]`)
    expect(
      preservation.serialize(editor.ctx.get(editorViewCtx).state.doc),
    ).toBe(source)
  })
})

test('unsupported wiki block references remain literal even when a standard reference definition matches', () =>
  run(
    '[[Note#^block]]\n\n[Note#^block]: https://example.test/\n',
    (editor, preservation) => {
      expect(
        editor.ctx.get(editorViewCtx).state.doc.firstChild!.type.name,
      ).toBe('literal_markdown')
      expect(nodes(editor, 'inkkit_wiki_link')).toHaveLength(0)
      expect(
        preservation.serialize(editor.ctx.get(editorViewCtx).state.doc),
      ).toBe('[[Note#^block]]\n\n[Note#^block]: https://example.test/\n')
    },
  ))

test('table resizing preserves target escapes and reopening uses the new width', () =>
  run(
    '| File |\n| --- |\n' + String.raw`| ![[A\\\|400#page=2\|120]] |` + '\n',
    (editor, preservation) => {
      const view = editor.ctx.get(editorViewCtx),
        image = nodes(editor, 'image')[0]!
      view.dispatch(
        closeHistory(
          view.state.tr.setNodeMarkup(image.position, undefined, {
            ...image.node.attrs,
            alt: 'A|400#page=2|180',
          }),
        ),
      )
      view.dispatch(closeHistory(view.state.tr).setMeta('addToHistory', false))
      const edited =
        '| File |\n| --- |\n' + String.raw`| ![[A\\\|400#page=2\|180]] |` + '\n'
      expect(preservation.serialize(view.state.doc)).toBe(edited)
      expect(fileReference(nodes(editor, 'image')[0]!.node)).toMatchObject({
        reference: 'A|400#page=2',
        width: 180,
      })
      expect(undo(view.state, view.dispatch)).toBe(true)
      expect(preservation.serialize(view.state.doc)).toContain(
        String.raw`![[A\\\|400#page=2\|120]]`,
      )
    },
  ))

test('public source replacement, mode round trips, history and reload retain optional syntax', async () => {
  const root = document.createElement('div')
  document.body.append(root)
  const editor = await InkKitEditor.mount(
    root,
    { changed() {}, stateChanged() {}, copy() {}, openLink() {} },
    {
      wikiLinks: { open() {} },
      files: { resolve: async () => ({ kind: 'file', label: 'Opaque file' }) },
    },
  )
  const original = '__Before__ [[#Heading|Alias]] ![[A\\|400#page=2|120]]\r\n'
  const changed = original.replace('Alias', 'New alias').replace('|120', '|180')
  try {
    editor.loadDocument({
      documentId: 'linked',
      generation: 1,
      format: 'md',
      text: original,
    })
    editor.setEditingMode('source')
    expect(editor.replaceSource(changed)).toBe(true)
    expect(editor.snapshot().text).toBe(changed)
    editor.setEditingMode('formatted')
    expect(root.querySelector('.inkkit-wiki-link')?.textContent).toBe(
      'New alias',
    )
    expect(editor.undo()).toBe(true)
    expect(editor.snapshot().text).toBe(original)
    expect(editor.redo()).toBe(true)
    expect(editor.snapshot().text).toBe(changed)
    editor.reloadDocument({
      documentId: 'linked',
      generation: 2,
      format: 'md',
      text: changed,
    })
    expect(editor.snapshot().text).toBe(changed)
    editor.setEditingMode('source')
    expect(root.querySelector('textarea')!.value).toBe(
      changed.replaceAll('\r\n', '\n'),
    )
  } finally {
    await editor.destroy()
    root.remove()
  }
})
