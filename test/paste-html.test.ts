import { expect, test } from 'vitest'
import {
  Editor,
  defaultValueCtx,
  editorViewCtx,
  remarkStringifyOptionsCtx,
  rootCtx,
} from '@milkdown/kit/core'
import { createDialect, serialize, stringifyOptions } from '../src/dialect'
import { imageView } from '../src/images'
import { PasteController } from '../src/paste'
import type { ClipboardInput, ImageAdapter } from '../src/types'

const adapter: ImageAdapter = {
  presentation: (reference) => ({ url: `private://image/${reference}` }),
  importImage: async () => ({ reference: 'images/photo.png' }),
  exportImage: async () => ({
    bytes: new Uint8Array(),
    mimeType: 'image/png',
  }),
}
const pixel =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='

async function pasted(
  input: Partial<ClipboardInput>,
  images: ImageAdapter = adapter,
): Promise<{ markdown: string; dom: HTMLElement }> {
  const root = document.createElement('div')
  document.body.append(root)
  let editor!: Editor
  const paste = new PasteController({
    ctx: () => editor.ctx,
    context: () => ({
      documentId: 'note',
      generation: 1,
      operationId: 'paste',
    }),
    adapter: images,
  })
  editor = await Editor.make()
    .config((ctx) => {
      ctx.set(rootCtx, root)
      ctx.set(defaultValueCtx, '')
      ctx.set(remarkStringifyOptionsCtx, stringifyOptions)
    })
    .use(createDialect(true))
    .use(imageView(images))
    .use(paste.plugin)
    .create()
  try {
    await paste.paste({ text: 'clipboard text', ...input })
    return {
      markdown: serialize(editor.ctx),
      dom: editor.ctx.get(editorViewCtx).dom,
    }
  } finally {
    paste.destroy()
    await editor.destroy()
    root.remove()
  }
}
const fromHTML = async (html: string) => (await pasted({ html })).markdown

test('browser clipboard wrappers produce only the copied content', async () => {
  expect(
    await fromHTML(
      "<html><body><meta charset='utf-8'><!--StartFragment--><p>Hello <b>world</b></p><!--EndFragment--></body></html>",
    ),
  ).toBe('Hello **world**\n')
  expect(
    await fromHTML(
      '<html><head><meta http-equiv="content-type" content="text/html; charset=utf-8"><title>Page</title></head><body><p>Only this</p></body></html>',
    ),
  ).toBe('Only this\n')
})

test('inline wrappers keep their text in the same paragraph', async () => {
  const { markdown, dom } = await pasted({
    html: '<p>Water is H<sub>2</sub>O and x<sup>2</sup> is <u>underlined</u>, <small>small</small>, <abbr title="HyperText Markup Language">HTML</abbr> on <time datetime="2026-01-02">2 January</time> with <mark>marks</mark>, <cite>a source</cite>, <ins>added</ins> and <label for="a">labelled</label>.</p>',
  })
  expect(markdown).toBe(
    'Water is H2O and x2 is underlined, small, HTML on 2 January with ==marks==, a source, added and labelled.\n',
  )
  expect(dom.querySelectorAll('p')).toHaveLength(1)
})

test('inline wrappers keep formatting inside them and survive nesting', async () => {
  expect(
    await fromHTML(
      '<p><u><strong>Bold underline</strong> and <a href="https://example.test/">a link</a></u> then <small><sub><em>deep</em></sub></small></p>',
    ),
  ).toBe('**Bold underline** and [a link](https://example.test/) then *deep*\n')
})

test('figures keep their image and caption', async () => {
  expect(
    await fromHTML(
      `<figure class="wp-block-image">\n  <img src="${pixel}" alt="A pixel">\n  <figcaption>\n    Photo by <a href="https://example.test/ada">Ada</a>\n    in 2026\n  </figcaption>\n</figure>\n<p>After</p>`,
    ),
  ).toBe(
    '![A pixel](images/photo.png)\n\nPhoto by [Ada](https://example.test/ada) in 2026\n\nAfter\n',
  )
})

test('picture contributes its img and drops its sources', async () => {
  expect(
    await fromHTML(
      `<p>Before</p><picture><source srcset="a.webp 1x, b.webp 2x" type="image/webp"><source media="(min-width: 800px)" srcset="wide.jpg"><img src="${pixel}" alt="Responsive" srcset="x.jpg 2x"></picture><p>After</p>`,
    ),
  ).toBe('Before\n\n![Responsive](images/photo.png)\n\nAfter\n')
})

test('a figure holding a picture and caption imports as one image and a caption', async () => {
  expect(
    await fromHTML(
      `<figure><picture><source srcset="a.webp" type="image/webp"><img src="${pixel}" alt="Alt"></picture><figcaption>Caption</figcaption></figure>`,
    ),
  ).toBe('![Alt](images/photo.png)\n\nCaption\n')
})

test('GitHub task lists become task items with their checked state', async () => {
  expect(
    await fromHTML(
      '<ul class="contains-task-list">\n<li class="task-list-item"><input type="checkbox" class="task-list-item-checkbox" disabled> open item</li>\n<li class="task-list-item"><input type="checkbox" class="task-list-item-checkbox" disabled checked> finished item</li>\n<li>ordinary item</li>\n</ul>',
    ),
  ).toBe('- [ ] open item\n- [x] finished item\n- ordinary item\n')
})

test('checkboxes wrapped in paragraphs, labels or untidy whitespace still become task items', async () => {
  expect(
    await fromHTML(
      '<ul>\n  <li>\n    <input type="checkbox" checked>\n    Spaced out\n  </li>\n  <li><p><input type="checkbox"> Loose item</p></li>\n  <li><label><input type="checkbox" checked="checked"> Labelled item</label></li>\n</ul>',
    ),
  ).toBe('- [x] Spaced out\n- [ ] Loose item\n- [x] Labelled item\n')
})

test('task items work in ordered and nested lists', async () => {
  expect(
    await fromHTML(
      '<ol><li><input type="checkbox" checked> first<ul><li><input type="checkbox"> nested</li></ul></li><li><input type="checkbox"> second</li></ol>',
    ),
  ).toBe('1. [x] first\n   - [ ] nested\n2. [ ] second\n')
})

test('checkboxes and other form controls outside a leading list position add no markup', async () => {
  const markdown = await fromHTML(
    '<p>Choose <input type="checkbox" checked> this <input type="text" value="typed"> and <input type="hidden" name="csrf" value="1">that</p><ul><li>Not first <input type="checkbox"></li></ul>',
  )
  expect(markdown).not.toContain('<input')
  expect(markdown).not.toContain('[x]')
  expect(markdown).toMatch(/Choose\s+this\s+and\s*that/)
  expect(markdown).toMatch(/- Not first/)
})

test('definition lists become a bold term over its definitions', async () => {
  expect(
    await fromHTML(
      '<dl>\n <dt>\n  Markdown\n </dt>\n <dd>\n  A lightweight <em>markup</em> language.\n </dd>\n <dd>Plain text first.</dd>\n <dt>Editor</dt>\n <dd>Something that edits.</dd>\n</dl>',
    ),
  ).toBe(
    '**Markdown**\n\nA lightweight *markup* language.\n\nPlain text first.\n\n**Editor**\n\nSomething that edits.\n',
  )
})

test('definition lists with grouped terms and empty entries stay tidy', async () => {
  expect(
    await fromHTML(
      '<dl><div><dt>One</dt><dt>Uno</dt><dd>Number</dd></div><dt></dt><dd> </dd><dt><strong>Bold</strong></dt><dd>Already</dd></dl>',
    ),
  ).toBe('**One**\n\n**Uno**\n\nNumber\n\n**Bold**\n\nAlready\n')
})

test('style, meta, link and title elements produce no content', async () => {
  expect(
    await fromHTML(
      '<style>p { color: red }</style><title>Page title</title><link rel="stylesheet" href="a.css"><meta name="x" content="y"><meta itemprop="datePublished" content="2026-01-01"><p>Body <style>.x{}</style>text</p>',
    ),
  ).toBe('Body text\n')
})

test('nested spans with inline styles keep only their text and emphasis', async () => {
  expect(
    await fromHTML(
      '<meta charset="utf-8"><span style="color: rgb(0, 0, 0); font-family: Arial;"><span style="font-size: 14px;">Styled </span><span style="font-weight: 700;">bold</span><span style="font-size: 14px;"> text</span></span>',
    ),
  ).toBe('Styled **bold** text\n')
})

test('unclosed tags and empty elements add no stray blocks', async () => {
  expect(
    await fromHTML(
      '<p>One <u>under<p>Two <sub>low<p>A</p><u></u><sub> </sub><figure></figure><figure>\n</figure><dl></dl><picture></picture><dl><dt></dt></dl><p>B</p>',
    ),
  ).toBe('One under\n\nTwo low\n\nA\n\nB\n')
})

test('elements that stay opaque keep their descendants untouched', async () => {
  const markdown = await fromHTML(
    '<!--StartFragment--><p>Before</p><custom-widget><style>.a{}</style><u>kept</u><input type="checkbox"></custom-widget><svg><title>Icon</title><style>.b{}</style></svg><iframe src="https://example.test/frame"></iframe><!--author--><p>After</p><!--EndFragment-->',
  )
  expect(markdown).toContain(
    '<custom-widget><style>.a{}</style><u>kept</u><input type="checkbox"></custom-widget>',
  )
  expect(markdown).toContain(
    '<svg><title>Icon</title><style>.b{}</style></svg>',
  )
  expect(markdown).toContain(
    '<iframe src="https://example.test/frame"></iframe>',
  )
  expect(markdown).toContain('<!--author-->')
  expect(markdown).not.toMatch(/StartFragment|EndFragment/)
})

test('a typical browser article copy imports as readable Markdown', async () => {
  const markdown = await fromHTML(
    `<meta charset='utf-8'><!--StartFragment--><style>.post { margin: 0 }</style><h2 style="margin: 0px;"><span style="font-size: 24px;">Release notes</span></h2><p>Published <time datetime="2026-10-01">1 October</time> by <a href="https://example.test/ada">Ada</a>.</p><figure><picture><source srcset="hero.webp" type="image/webp"><img src="${pixel}" alt="Hero"></picture><figcaption>The <u>new</u> editor</figcaption></figure><p>H<sub>2</sub>O is <abbr title="Water">water</abbr>.</p><ul class="contains-task-list"><li class="task-list-item"><input type="checkbox" disabled checked> Ship it</li><li class="task-list-item"><input type="checkbox" disabled> Announce it</li></ul><dl><dt>Term</dt><dd>Meaning</dd></dl><script>globalThis.never = true</script><!--EndFragment-->`,
  )
  expect(markdown).toBe(
    [
      '## Release notes',
      'Published 1 October by [Ada](https://example.test/ada).',
      '![Hero](images/photo.png)',
      'The new editor',
      'H2O is water.',
      '- [x] Ship it\n- [ ] Announce it',
      '**Term**',
      'Meaning',
      '<script>globalThis.never = true</script>',
    ].join('\n\n') + '\n',
  )
})

test('plain text and Markdown source paste are not interpreted as HTML', async () => {
  const source =
    '<u>under</u> and <sub>low</sub>\n\n<style>p { color: red }</style>\n\n<figure><figcaption>Caption</figcaption></figure>\n\n- [x] done\n'
  const text = await pasted({ text: source })
  expect(text.markdown).toContain('<u>under</u> and <sub>low</sub>')
  expect(text.markdown).toContain('<style>p { color: red }</style>')
  expect(text.markdown).toContain('- [x] done')
  const literal = await pasted({ text: source, plainText: true })
  expect(literal.markdown.replace(/\\/g, '')).toContain('<u>under</u>')
  const explicit = await pasted({
    text: 'ignored',
    markdown: source,
    html: '<p>ignored</p>',
  })
  expect(explicit.markdown).toBe(source)
})

test('literal elements keep their whitespace inside task items and definitions', async () => {
  const task = await fromHTML(
    '<ul><li><input type="checkbox"> a<custom-x>a    b\n c</custom-x></li></ul>',
  )
  expect(task).toMatch(/<custom-x>a {4}b\n {3}c<\/custom-x>/)
  const definition = await fromHTML(
    '<dl><dd><script>var a   =  1;\n var b</script></dd></dl>',
  )
  expect(definition).toContain('<script>var a   =  1;\n var b</script>')
})

test('pretty-printed task items and definitions leave no trailing space before a nested list', async () => {
  expect(
    await fromHTML(
      '<ul>\n<li><input type="checkbox"> parent\n<ul>\n<li><input type="checkbox" checked> child\n</li>\n</ul>\n</li>\n</ul>',
    ),
  ).toBe('- [ ] parent\n  - [x] child\n')
  expect(
    await fromHTML('<dl><dd>\n text\n <ul><li>x</li></ul>\n</dd></dl>'),
  ).toBe('text\n\n- x\n')
})

test('definition terms with block content become one bold line', async () => {
  expect(
    await fromHTML(
      '<dl><dt><p>Term</p></dt><dd>Def</dd><dt><h3>Head</h3></dt><dd>Second</dd><dt><div><p>Nested</p></div> tail</dt><dd>Third</dd></dl>',
    ),
  ).toBe(
    '**Term**\n\nDef\n\n**Head**\n\nSecond\n\n**Nested**\n\n**tail**\n\nThird\n',
  )
})

test('a paragraph emptied by a dropped element adds no blank paragraph', async () => {
  expect(
    await fromHTML(
      '<p><style>a{}</style></p><p><input type="checkbox"></p><p><span><meta charset="utf-8"></span></p><p>Kept</p><p><link rel="x" href="y"> </p>',
    ),
  ).toBe('Kept\n')
})

test('tables beside other content import with common wrappers in their cells', async () => {
  expect(
    await fromHTML(
      '<p>Intro</p><table><tr><th>Name</th><th>When</th></tr><tr><td><u>Ada</u></td><td><time datetime="2026-01-02">2 Jan</time> <abbr title="Coordinated">UTC</abbr></td></tr><tr><td><label>yes</label></td><td><small>s</small><style>td{}</style></td></tr></table>',
    ),
  ).toBe(
    'Intro\n\n| Name | When      |\n| ---- | --------- |\n| Ada  | 2 Jan UTC |\n| yes  | s         |\n',
  )
})

test('tables that stay unsupported keep their source untouched', async () => {
  const merged = '<table><tr><td colspan="2"><u>  a   b </u></td></tr></table>'
  expect(await fromHTML(merged)).toContain(merged)
  const custom =
    '<table><tr><td><custom-x>  a   b </custom-x></td></tr></table>'
  expect(await fromHTML(custom)).toContain(custom)
})

test('tables inside an element that stays literal keep their source exactly', async () => {
  const table =
    '<table><tbody><tr><th>Name</th></tr><tr><td><u>x</u> <input type="checkbox"></td></tr></tbody></table>'
  const details = `<details><summary>s</summary>${table}</details>`
  expect(await fromHTML(`<p>Before</p>${details}`)).toContain(details)
  const custom = `<custom-x>${table}</custom-x>`
  expect(await fromHTML(`<p>Before</p>${custom}`)).toContain(custom)
})

test('a table whose ancestors all import is still normalised', async () => {
  expect(
    await fromHTML(
      '<div><section><table><tr><th>Name</th></tr><tr><td><u>Ada</u></td></tr></table></section></div>',
    ),
  ).toBe('| Name |\n| ---- |\n| Ada  |\n')
})

test('a checkbox in a table cell keeps the table as source so its state survives', async () => {
  for (const checkbox of [
    '<input type="checkbox" checked="">',
    '<input type="checkbox">',
    '<label><input type="checkbox" checked=""> done</label>',
    '<input type="text" value="typed">',
  ]) {
    const table = `<table><tbody><tr><th>Done</th></tr><tr><td>${checkbox}</td></tr></tbody></table>`
    expect(await fromHTML(`<p>Intro</p>${table}`)).toContain(table)
  }
})

test('text styled to keep its whitespace is not collapsed', async () => {
  const markdown = await fromHTML(
    '<div style="white-space: pre"><div><span>    </span><span>return</span><span> x</span></div></div>',
  )
  expect(markdown.replace(/&#x20;/g, ' ')).toContain('    return x')
  const inline = await fromHTML(
    '<p>Run <span style="white-space: pre">    code  here</span> now</p>',
  )
  expect(inline.replace(/&#x20;/g, ' ')).toContain('    code  here')
  expect(inline).toContain('Run')
  expect(inline).toContain('now')
})

test('white-space values are read as CSS, not matched as text', async () => {
  for (const style of [
    'white-space: pre-wrap',
    'WHITE-SPACE:PRE',
    'color: red;white-space :  pre !important',
    'white-space: break-spaces;',
    'white-space: pre-line',
    'white-space-collapse: preserve',
    '/* code */ white-space: pre',
    'white-space: pre !important; white-space: normal',
  ]) {
    const markdown = await fromHTML(
      `<p>a<span style="${style}">    b</span></p>`,
    )
    expect(markdown.replace(/&#x20;/g, ' '), style).toContain('a    b')
  }
  for (const style of [
    'white-space: normal',
    'white-space: nowrap',
    'white-space: pre; white-space: normal',
    'content: "white-space: pre"',
    '--note: white-space: pre',
    'content: "x; white-space: pre"',
    '/* white-space: pre */ color: red',
  ]) {
    expect(
      await fromHTML(`<p>a<span style="${style}">    b</span></p>`),
      style,
    ).toBe('a b\n')
  }
})

test('indentation inside pretty-printed blocks is not imported as text', async () => {
  expect(await fromHTML('<p>\n  text\n</p>')).toBe('text\n')
  expect(await fromHTML('<ul>\n  <li>\n    item\n  </li>\n</ul>')).toBe(
    '- item\n',
  )
  expect(
    await fromHTML(
      '<ul>\n  <li>\n    one\n  </li>\n  <li>\n    two\n    <ul>\n      <li>\n        nested\n      </li>\n    </ul>\n  </li>\n</ul>',
    ),
  ).toBe('- one\n- two\n  - nested\n')
  expect(await fromHTML('<div>\n  <p>\n    a\n    b   c\n  </p>\n</div>')).toBe(
    'a b c\n',
  )
  expect(await fromHTML('<div>\n  loose   text\n</div>')).toBe('loose text\n')
})

test('whitespace between inline elements collapses to one space', async () => {
  expect(await fromHTML('<p><span> a </span> <span> b</span></p>')).toBe(
    'a b\n',
  )
  expect(
    await fromHTML('<p>Hello <em>there</em> <strong>big</strong>\n world</p>'),
  ).toBe('Hello *there* **big** world\n')
  expect(await fromHTML('<p>one<br>\n   two</p>')).not.toMatch(/ {2}\S|&#x20;/)
  expect(await fromHTML('<p>a&nbsp;&nbsp;b</p>')).toBe('a\u00a0\u00a0b\n')
})

test('whitespace around emphasis edges stays outside the emphasis', async () => {
  expect(await fromHTML('<p>Hello <strong> bold </strong> world</p>')).toBe(
    'Hello **bold** world\n',
  )
})

test('code and preformatted whitespace is preserved', async () => {
  const markdown = await fromHTML(
    '<p>use <code>a   b</code> now</p><pre><code>x   y\n    z\n</code></pre>',
  )
  expect(markdown).toContain('`a   b`')
  expect(markdown).toContain('x   y\n    z')
})

test('plain-text paste keeps its spaces', async () => {
  const { markdown } = await pasted({ text: 'a   b', plainText: true })
  expect(markdown).toContain('a   b')
})

const counting = (): ImageAdapter => {
  let count = 0
  return {
    ...adapter,
    importImage: async () => ({ reference: `images/${++count}.png` }),
  }
}
const pixelTwo = pixel.replace('AAAADUlEQVR4', 'AAAADUlEQVR5')
const wrapper = (inner: string) =>
  `<div data-inkkit-markdown="${'![A](inkkit-clipboard-image:0)\n\n![B](inkkit-clipboard-image:1)'.replace(/\n/g, '&#10;')}">${inner}</div>`

test('InkKit Markdown wrapper keeps image order through picture and figure', async () => {
  const { markdown } = await pasted(
    {
      html: wrapper(
        `<figure><picture><source srcset="a.webp"><img src="${pixel}" alt="A"></picture><figcaption>One</figcaption></figure><p><img src="${pixelTwo}" alt="B"></p>`,
      ),
    },
    counting(),
  )
  expect(markdown).toBe('![A](images/1.png)\n\n![B](images/2.png)\n')
})

test('InkKit Markdown wrapper maps image slots after picture is replaced', async () => {
  const { markdown } = await pasted(
    {
      html: wrapper(
        `<figure><picture><source srcset="a.webp"><img data-inkkit-image-slot="1" src="${pixelTwo}" alt="B"></picture></figure><p><img data-inkkit-image-slot="0" src="${pixel}" alt="A"></p>`,
      ),
    },
    counting(),
  )
  expect(markdown).toBe('![A](images/2.png)\n\n![B](images/1.png)\n')
})
