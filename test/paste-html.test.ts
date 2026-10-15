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
import { PasteController, type PasteInput } from '../src/paste'
import type { ImageAdapter } from '../src/types'

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
  input: Partial<PasteInput>,
  images: ImageAdapter = adapter,
  wikiLinks = false,
  files = false,
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
    .use(createDialect(true, wikiLinks, files))
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
  expect(markdown).not.toContain('author')
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
    'white-space: pre-line',
    'white-space-collapse: preserve-breaks',
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

test('code and images styled to keep whitespace keep the spaces beside them', async () => {
  // Chrome puts GitHub's `white-space: break-spaces` on each copied code element.
  const code = 'style="white-space: break-spaces"'
  expect(
    await fromHTML(
      `<p>Run the <code ${code}>pnpm check</code> command and <a href="https://x.test"><code ${code}>link</code></a> here.</p>`,
    ),
  ).toBe('Run the `pnpm check` command and [`link`](https://x.test) here.\n')
  expect(
    await fromHTML(
      '<p>See <img style="white-space: pre" src="i.png" alt="i"> now</p>',
    ),
  ).toMatch(/^See \S.*\S now\n$/)
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
const wrapper = (
  inner: string,
  markdown = '![A](inkkit-clipboard-image:0)\n\n![B](inkkit-clipboard-image:1)',
) =>
  `<div data-inkkit-markdown="${markdown.replace(/\n/g, '&#10;')}">${inner}</div>`

test('InkKit Markdown wrapper keeps image order through picture and figure', async () => {
  const { markdown } = await pasted(
    {
      html: wrapper(
        `<figure><picture><source srcset="a.webp"><img src="${pixel}" alt="A"></picture></figure><p><img src="${pixelTwo}" alt="B"></p>`,
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
        '![B](inkkit-clipboard-image:1)\n\n![A](inkkit-clipboard-image:0)',
      ),
    },
    counting(),
  )
  expect(markdown).toBe('![B](images/1.png)\n\n![A](images/2.png)\n')
})

test('images keep the order the pasted HTML shows', async () => {
  const { markdown } = await pasted(
    {
      html: wrapper(
        `<p><img data-inkkit-image-slot="1" src="${pixelTwo}" alt="B"></p><p><img data-inkkit-image-slot="0" src="${pixel}" alt="A"></p>`,
      ),
    },
    counting(),
  )
  expect(markdown).toBe('![B](images/1.png)\n\n![A](images/2.png)\n')
})

// WebKit rewrites a space beside an inline element on its way to the clipboard.
const converted = (text = '&nbsp;') =>
  `<span class="Apple-converted-space">${text}</span>`
const webkitStyle =
  'style="caret-color: rgb(0, 0, 0); color: rgb(0, 0, 0); font-family: Times; white-space: normal;"'

test('WebKit converted spaces import as ordinary spaces beside links', async () => {
  const after = await fromHTML(
    `<meta charset='utf-8'><a href="https://example.com" ${webkitStyle}>The quote</a><span ${webkitStyle}>${converted()}for the record</span>`,
  )
  expect(after).toBe('[The quote](https://example.com) for the record\n')
  expect(after).not.toContain(' ')
  const before = await fromHTML(
    `<p><span ${webkitStyle}>See${converted()}</span><a href="https://example.com" ${webkitStyle}>the quote</a></p>`,
  )
  expect(before).toBe('See [the quote](https://example.com)\n')
  expect(before).not.toContain(' ')
})

test('a run of WebKit converted spaces collapses like ordinary spaces', async () => {
  const markdown = await fromHTML(
    `<p>one${converted('&nbsp; &nbsp; ')}<strong>two</strong>${converted('&nbsp;&nbsp;')}three</p>`,
  )
  expect(markdown).toBe('one **two** three\n')
})

test('WebKit converted spaces at the edge of a block add nothing', async () => {
  expect(
    await fromHTML(`<p>${converted()}<em>edge</em>${converted()}</p>`),
  ).toBe('*edge*\n')
})

test('WebKit converted spaces keep their width in code', async () => {
  const inline = await fromHTML(
    `<p>run <code>a${converted('&nbsp;&nbsp;&nbsp;')}b</code> now</p>`,
  )
  expect(inline).toBe('run `a   b` now\n')
  const block = await fromHTML(
    `<pre><code>if (x) {\n${converted('&nbsp; &nbsp; ')}return${converted()}y\n}</code></pre>`,
  )
  expect(block).toContain('if (x) {\n    return y\n}')
  expect(block).not.toContain(' ')
  const styled = await fromHTML(
    `<div style="white-space: pre">a${converted('&nbsp; &nbsp;')}<span>b</span></div>`,
  )
  expect(styled.replace(/&#x20;/g, ' ')).toContain('a   b')
  expect(styled).not.toContain(' ')
})

test('WebKit converted spaces in a table cell import as ordinary spaces', async () => {
  const table = (space: string) =>
    `<p>Intro</p><table><tr><th>Name</th></tr><tr><td>Ada${space}<a href="https://example.test/">Lovelace</a></td></tr></table>`
  const markdown = await fromHTML(table(converted()))
  expect(markdown).toBe(await fromHTML(table(' ')))
  expect(markdown).toContain('Lovelace')
  expect(markdown).not.toContain('\u00a0')
})

test('authored non-breaking spaces stay when a converted space is beside them', async () => {
  expect(await fromHTML('<p>a&nbsp;b</p>')).toBe('a b\n')
  expect(await fromHTML(`<p>a&nbsp;${converted()}b</p>`)).toBe('a  b\n')
  expect(
    await fromHTML(`<p>a${converted()}<span>&nbsp;</span>b&nbsp;&nbsp;c</p>`),
  ).toBe('a  b  c\n')
  expect(
    await fromHTML(
      '<p><span class="converted-space">&nbsp;</span>x<span>&nbsp;</span>y</p>',
    ),
  ).toBe(' x y\n')
})

test('a converted-space span in literal source is kept as written', async () => {
  const widget = `<custom-x>a${converted()}b</custom-x>`
  expect(await fromHTML(widget)).toContain(widget)
})

test('a spreadsheet cell with a converted space keeps an ordinary space', async () => {
  const table = (space: string) =>
    `<table><tbody><tr><td>Ada${space}<a href="https://example.test/">Lovelace</a></td><td>b</td></tr></tbody></table>`
  const markdown = await fromHTML(table(converted()))
  expect(markdown).toBe(await fromHTML(table(' ')))
  expect(markdown).toContain('Lovelace')
  expect(markdown).not.toContain('\u00a0')
})

const linkOf = (href: string, text = 'text') =>
  `<p>before <a href="${href}">${text}</a> after</p>`

test('pasted links keep http, https, mailto, tel, relative and fragment addresses', async () => {
  for (const href of [
    'https://example.com/a?b=c#d',
    'HTTP://EXAMPLE.COM/',
    'mailto:ada@example.com',
    'tel:+441234567890',
    '/notes/today.md',
    './today.md',
    '../up/today.md',
    'today.md',
    'folder/note.md#heading',
    '?query=1',
    '#section',
    '//example.com/path',
    ' https://example.com/padded ',
  ]) {
    const markdown = await fromHTML(linkOf(href))
    expect(markdown, href).toMatch(/^before \[text\]\(.+\) after\n$/)
  }
})

test('pasted links with script or unknown schemes keep their text without the link', async () => {
  for (const href of [
    'javascript:alert(1)',
    'JavaScript:alert(1)',
    ' \tjavascript:alert(1)',
    '\u0001javascript:alert(1)',
    'java\tscript:alert(1)',
    'java\nscript:alert(1)',
    'java\u0000script:alert(1)',
    'jav&#x61;script:alert(1)',
    '&#106;avascript:alert(1)',
    '&#x6A;avascript&colon;alert(1)',
    '&#0000106avascript:alert(1)',
    'javascript&#58;alert(1)',
    '​javascript:alert(1)',
    'vbscript:msgbox(1)',
    'data:text/html,<b>x</b>',
    'DATA:text/html;base64,PGI+eDwvYj4=',
    'file:///etc/hosts',
    'ftp://example.com/',
    'slack://channel?id=1',
    'x-custom:thing',
    ':nothing',
    'blob:https://example.com/id',
  ]) {
    expect(await fromHTML(linkOf(href)), href).toBe('before text after\n')
  }
})

test('pasted links with a script scheme drop only the link, not its content', async () => {
  expect(
    await fromHTML(
      '<p><a href="javascript:void(0)"><strong>bold</strong> and <em>more</em></a></p>',
    ),
  ).toBe('**bold** and *more*\n')
  expect(
    await fromHTML(
      '<p><a href="javascript:void(0)">a <a href="https://example.com/">b</a></a></p>',
    ),
  ).toMatch(/^a \[b\]\(https:\/\/example\.com\/\)\n$/)
  expect(
    await fromHTML(
      '<table><tr><th>Link</th></tr><tr><td><a href="vbscript:x">cell</a></td></tr></table><p>after</p>',
    ),
  ).toBe('| Link |\n| ---- |\n| cell |\n\nafter\n')
  expect(
    await fromHTML(
      '<ul><li><a href="javascript:x">item</a></li><li><a href="https://example.com/">ok</a></li></ul>',
    ),
  ).toBe('- item\n- [ok](https://example.com/)\n')
})

test('a standalone table with script-scheme links keeps their text without the link', async () => {
  const markdown = await fromHTML(
    '<table><tbody><tr><td><a href="javascript:alert(1)">one</a></td><td><a href="https://example.com/">two</a></td></tr></tbody></table>',
  )
  expect(markdown).not.toMatch(/javascript/i)
  expect(markdown).toContain('one')
  expect(markdown).toContain('[two](https://example.com/)')
})

test('pasted images never carry their address into the Markdown', async () => {
  for (const src of [
    'javascript:alert(1)',
    '&#106;avascript:alert(1)',
    'vbscript:x',
    'data:text/html,<b>x</b>',
  ]) {
    const markdown = (
      await pasted({ html: `<p><img src="${src}" alt="Picture"></p>` })
    ).markdown
    expect(markdown, src).not.toMatch(/script|data:/i)
    expect(markdown, src).toContain('Picture')
  }
  expect(
    (
      await pasted({
        html: '<p><a href="javascript:x"><img src="javascript:y" alt="Linked"></a></p>',
        images: [{ bytes: new Uint8Array([1]), mimeType: 'image/png' }],
      })
    ).markdown,
  ).toBe('![Linked](images/photo.png)\n')
})

test('Markdown source keeps authored link addresses unchanged', async () => {
  const source = '[run](javascript:run) and [site](https://example.com/)\n'
  expect((await pasted({ markdown: source })).markdown).toBe(source)
  expect((await pasted({ text: source })).markdown).toBe(source)
  expect(
    (await pasted({ text: source, html: '<p>ignored</p>', markdown: source }))
      .markdown,
  ).toBe(source)
  expect(
    (await pasted({ text: source, plainText: true })).markdown.replace(
      /\\/g,
      '',
    ),
  ).toContain('[run](javascript:run)')
})

// HTML in the shape InkKit writes to the clipboard: its visible content with
// the Markdown it was copied from in an attribute.
const withMarkdown = (markdown: string, inner: string) =>
  `<div data-inkkit-markdown="${markdown
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/\n/g, '&#10;')}">${inner}</div>`
const linked = (text: string, href: string, label: string) =>
  `<a href="${href}" data-inkkit-reference="${label.toLowerCase()}" data-inkkit-label="${label}" data-inkkit-reference-type="full">${text}</a>`

test('pasted HTML saves the content it shows, not Markdown that describes other content', async () => {
  const markdown = [
    '[other](https://other.example/)',
    '[docs][d]',
    '[d]: https://other.example/',
    '<div>block</div>',
  ].join('\n\n')
  for (const html of [
    `<p>Shown text, <span data-inkkit-markdown="${markdown.replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/\n/g, '&#10;')}">here</span>.</p>`,
    withMarkdown(markdown, '<p>Shown text, here.</p>'),
  ]) {
    const saved = (await pasted({ text: 'Shown text, here.', html })).markdown
    expect(saved, html).toBe('Shown text, here.\n')
  }
})

test('a link in pasted HTML keeps the address it shows', async () => {
  for (const markdown of [
    '[run](javascript:run)',
    '[run](https://other.example/)',
    '[run][r]\n\n[r]: https://other.example/',
  ])
    expect(
      (
        await pasted({
          html: withMarkdown(
            markdown,
            '<p><a href="https://example.com/">run</a></p>',
          ),
        })
      ).markdown,
      markdown,
    ).toBe('[run](https://example.com/)\n')
})

test('Markdown copied with its HTML keeps references only where the HTML importer accepts them', async () => {
  const visible = `<p>${linked('docs', 'https://example.com/', 'D')} and ${linked('more', 'https://example.com/', 'D')}</p>`
  expect(
    (
      await pasted({
        html: withMarkdown(
          '[docs][D] and [more][D]\n\n[D]: https://example.com/\n',
          visible,
        ),
      })
    ).markdown,
  ).toBe('[docs][D] and [more][D]\n\n[D]: https://example.com/\n')
  // Definitions no link uses are not shown, so they are not kept.
  expect(
    (
      await pasted({
        html: withMarkdown(
          '[docs][D] and [more][D]\n\n[D]: https://example.com/\n\n[unused]: https://other.example/\n',
          visible,
        ),
      })
    ).markdown,
  ).toBe('[docs][D] and [more][D]\n\n[D]: https://example.com/\n')
  for (const url of [
    'javascript:run',
    '&#106;avascript:run',
    'data:text/html,x',
  ])
    expect(
      (
        await pasted({
          html: withMarkdown(
            `[docs][D] and [more][D]\n\n[D]: ${url}\n`,
            `<p>${linked('docs', url, 'D')} and ${linked('more', url, 'D')}</p>`,
          ),
        })
      ).markdown,
      url,
    ).toBe('docs and more\n')
})

test('raw HTML copied with its HTML is kept only where the HTML shows it as source', async () => {
  expect(
    (
      await pasted({
        html: withMarkdown(
          'Text [a][]\n\n<aside>note</aside>\n\n[a]: https://a.test\n',
          `<p>Text ${linked('a', 'https://a.test', 'a')}</p>`,
        ),
      })
    ).markdown,
  ).toBe('Text [a](https://a.test)\n')
  expect(
    (
      await pasted({
        html: withMarkdown(
          'Text [a][]\n\n<div>block</div>\n\n[a]: https://a.test\n',
          `<p>Text ${linked('a', 'https://a.test', 'a')}</p><pre class="inkkit-literal-markdown">&lt;div&gt;block&lt;/div&gt;</pre>`,
        ),
      })
    ).markdown,
  ).toBe('Text [a][]\n\n<div>block</div>\n\n[a]: https://a.test\n')
  // A reference written in literal source is not a link the HTML shows.
  expect(
    (
      await pasted({
        html: withMarkdown(
          'Text <b>raw</b> [a][]\n\n[a]: https://a.test\n',
          '<pre class="inkkit-literal-markdown">Text &lt;b&gt;raw&lt;/b&gt; [a][]</pre>',
        ),
      })
    ).markdown,
  ).toBe('Text <b>raw</b> [a][]\n')
})

test('comments copied with HTML are kept only where the HTML holds them', async () => {
  const visible = `<p>Text ${linked('a', 'https://a.test', 'a')}</p>`
  for (const markdown of [
    'Text [a][]%%note%%\n\n[a]: https://a.test\n',
    'Text [a][]<!--note-->\n\n[a]: https://a.test\n',
  ])
    expect(
      (await pasted({ html: withMarkdown(markdown, visible) })).markdown,
      markdown,
    ).toBe('Text [a](https://a.test)\n')
})

test('Markdown copied with its HTML keeps only the first definition of a label', async () => {
  expect(
    (
      await pasted({
        html: withMarkdown(
          '[docs][D]\n\n[D]: https://example.com/\n\n[D]: https://other.example/\n',
          `<p>${linked('docs', 'https://example.com/', 'D')}</p>`,
        ),
      })
    ).markdown,
  ).toBe('[docs][D]\n\n[D]: https://example.com/\n')
})

test('a label with comment syntax keeps the link as the HTML shows it', async () => {
  for (const markdown of [
    '[docs][a<!--note-->]\n\n[a<!--note-->]: https://example.com/\n',
    '[docs][a%%note%%]\n\n[a%%note%%]: https://example.com/\n',
  ])
    expect(
      (
        await pasted({
          html: withMarkdown(
            markdown,
            `<p>${linked('docs', 'https://example.com/', 'a')}</p>`,
          ),
        })
      ).markdown,
      markdown,
    ).toBe('[docs](https://example.com/)\n')
})

test('a wiki link copied with its HTML stays a link only where it shows its target', async () => {
  const visible = (text: string) =>
    `<p><span>${text}</span> and ${linked('a', 'https://a.test', 'a')}</p>`
  expect(
    (
      await pasted(
        {
          html: withMarkdown(
            '[[Page]] and [a][]\n\n[a]: https://a.test\n',
            visible('Page'),
          ),
        },
        adapter,
        true,
      )
    ).markdown,
  ).toBe('[[Page]] and [a][]\n\n[a]: https://a.test\n')
  expect(
    (
      await pasted(
        {
          html: withMarkdown(
            '[[Target|Shown]] and [a][]\n\n[a]: https://a.test\n',
            visible('Shown'),
          ),
        },
        adapter,
        true,
      )
    ).markdown,
  ).toBe('Shown and [a][]\n\n[a]: https://a.test\n')
})

test('HTML that imports as nothing pastes the text that came with it', async () => {
  expect(
    (await pasted({ text: 'Shown text', html: '<meta charset="utf-8">' }))
      .markdown,
  ).toBe('Shown text\n')
})

test('a table with Markdown beside it pastes as the same table without it', async () => {
  const table =
    '<table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table>'
  expect(
    (await pasted({ html: withMarkdown('| A |\n| - |\n| x |', table) }))
      .markdown,
  ).toBe((await pasted({ html: `<div>${table}</div>` })).markdown)
})

// A drop or an editor-level HTML insert reaches the schema's parse rules
// without the paste importer.
async function dropped(html: string, wikiLinks = false): Promise<string> {
  const root = document.createElement('div')
  document.body.append(root)
  const editor = await Editor.make()
    .config((ctx) => {
      ctx.set(rootCtx, root)
      ctx.set(defaultValueCtx, '')
      ctx.set(remarkStringifyOptionsCtx, stringifyOptions)
    })
    .use(createDialect(true, wikiLinks))
    .create()
  try {
    editor.ctx
      .get(editorViewCtx)
      .pasteHTML(html, new Event('paste') as ClipboardEvent)
    return serialize(editor.ctx)
  } finally {
    await editor.destroy()
    root.remove()
  }
}

const definition = (url: string) =>
  `<div data-inkkit-reference-definition="x" data-inkkit-label="x" data-inkkit-url="${url}" class="inkkit-reference-definition">[x]: ${url}</div>`
const reference = (href: string) =>
  `<p><a href="${href}" data-inkkit-reference="x" data-inkkit-label="x" data-inkkit-reference-type="full">text</a></p>`

test('a reference definition in pasted HTML keeps only a safe address', async () => {
  const kept = await pasted({ html: definition('https://example.com/') })
  expect(
    kept.dom.querySelectorAll('.inkkit-reference-definition'),
  ).toHaveLength(1)
  for (const url of [
    'javascript:run',
    '&#106;avascript:run',
    'data:text/html,x',
  ]) {
    const { dom, markdown } = await pasted({
      html: `${reference('https://example.com/')}${definition(url)}`,
    })
    expect(
      dom.querySelectorAll('.inkkit-reference-definition'),
      url,
    ).toHaveLength(0)
    expect(markdown, url).not.toMatch(/^\[x\]: (?:javascript|data)/m)
  }
})

test('HTML inserted without the importer keeps only safe addresses', async () => {
  const kept = await dropped(
    `${reference('https://example.com/')}${definition('https://example.com/')}`,
  )
  expect(kept).toContain('[text][x]')
  expect(kept).toContain('[x]: https://example.com/')
  for (const url of ['javascript:run', 'JAVASCRIPT:run', 'data:text/html,x']) {
    const markdown = await dropped(
      `<p><a href="${url}">plain</a></p>${reference(url)}${definition(url)}`,
    )
    expect(markdown, url).not.toMatch(/\]\((?:javascript|data)/i)
    expect(markdown, url).not.toMatch(/^\[x\]: (?:javascript|data)/im)
    expect(markdown, url).toContain('plain')
  }
})

test('an image source with a script scheme is not kept when HTML is inserted', async () => {
  expect(await dropped('<p><img src="images/photo.png" alt="Kept"></p>')).toBe(
    '![Kept](images/photo.png)\n',
  )
  for (const src of [
    'javascript:run',
    ' JavaScript:run',
    'java\tscript:run',
    '&#106;avascript:run',
    'vbscript:run',
  ]) {
    const markdown = await dropped(`<p>a<img src="${src}" alt="Picture">b</p>`)
    expect(markdown, src).not.toMatch(/script/i)
    expect(markdown, src).toContain('ab')
  }
})

test('a converted space leaves literal source nested in its span unchanged', async () => {
  const markdown = await fromHTML(
    '<p>a<span class="Apple-converted-space">&nbsp;<custom-x>&nbsp;</custom-x></span>b</p>',
  )
  expect(markdown).toContain('<custom-x>&nbsp;</custom-x>')
})

test('InkKit elements import as the text they show when their attributes differ', async () => {
  const definitionHTML = (text: string) =>
    `<div data-inkkit-reference-definition="x" data-inkkit-label="x" data-inkkit-url="https://example.com/">${text}</div>`
  const footnote = (text: string) =>
    `<p>a<sup data-inkkit-footnote-reference="n" data-inkkit-label="n">${text}</sup></p><div data-inkkit-footnote-definition="n" data-inkkit-label="n"><p>body</p></div>`
  const wiki = (raw: string, text: string) =>
    `<p><span data-inkkit-wiki="x" data-inkkit-wiki-raw="${raw}">${text}</span></p>`
  for (const read of [
    (html: string) => dropped(html, true),
    async (html: string) => (await pasted({ html }, adapter, true)).markdown,
  ]) {
    expect(await read(definitionHTML('[x]: https://example.com/'))).toBe(
      '[x]: https://example.com/\n',
    )
    expect(await read(definitionHTML('Shown text'))).toBe('Shown text\n')
    expect(await read(wiki('[[Page]]', 'Page'))).toBe('[[Page]]\n')
    expect(await read(wiki('[[Page]]', 'Shown'))).toBe('Shown\n')
    expect(await read(wiki('[[Target|Shown]]', 'Shown'))).toBe('Shown\n')
  }
  expect(await dropped(footnote('n'))).toBe('a[^n]\n\nbody\n')
  expect(await dropped(footnote('Shown'))).toBe('aShown\n\nbody\n')
  expect(
    await dropped(footnote('n').replace('<p>body', '<span>[n] </span><p>body')),
  ).toBe('a[^n]\n\n[^n]: body\n')
})

test('a diagram figure pastes its source only when its image shows that source', async () => {
  const figure = (alt: string) =>
    `<figure data-inkkit-mermaid="graph TD; A-->B"><img src="${pixel}" alt="${alt}"></figure>`
  expect(await fromHTML(figure('Mermaid diagram: graph TD; A--&gt;B'))).toBe(
    '```mermaid\ngraph TD; A-->B\n```\n',
  )
  expect(await fromHTML(figure('Shown image'))).toBe(
    '![Shown image](images/photo.png)\n',
  )
  expect(
    await fromHTML(
      `<figure data-inkkit-mermaid="graph TD; A-->B"><img src="${pixel}" alt="Mermaid diagram: graph TD; A--&gt;B"><figcaption>Shown caption</figcaption></figure>`,
    ),
  ).toContain('Shown caption')
})

test('HTML inserted without the importer leaves out HTML comments', async () => {
  expect(await dropped('<p>a<!--note-->b</p><!--note--><p>c</p>')).toBe(
    'ab\n\nc\n',
  )
})

const fencedHTML = (info: string, marker = '```') =>
  `<pre data-language="js" data-inkkit-fence="{&quot;marker&quot;:&quot;${marker}&quot;,&quot;info&quot;:&quot;${info}&quot;,&quot;close&quot;:&quot;${marker}&quot;,&quot;trailing&quot;:&quot;&quot;,&quot;ending&quot;:&quot;\\n&quot;}"><code>x</code></pre>`

test('a code fence keeps only the language its block shows as its info', async () => {
  for (const read of [
    dropped,
    async (html: string) => (await pasted({ html })).markdown,
  ]) {
    expect(await read(fencedHTML('js more words'))).toBe('```js\nx\n```\n')
    expect(await read(fencedHTML('js more words', '~~~'))).toBe(
      '~~~js\nx\n~~~\n',
    )
    expect(await read(fencedHTML(' js', '~~~'))).toBe('~~~ js\nx\n~~~\n')
  }
  expect(
    (
      await pasted({
        html: withMarkdown(
          '[a][]\n\n```js more words\nx\n```\n\n[a]: https://a.test\n',
          `<p>${linked('a', 'https://a.test', 'a')}</p><pre data-language="js"><code>x</code></pre>`,
        ),
      })
    ).markdown,
  ).toBe('[a](https://a.test)\n\n```js\nx\n```\n')
})

const callout = (attributes: string, title: string) =>
  `<blockquote class="inkkit-callout" data-inkkit-callout="NOTE" data-inkkit-marker="[!NOTE]" ${attributes}><strong class="inkkit-callout-title">${title}</strong><div class="inkkit-callout-body"><p>Body <a href="https://a.test">a</a></p></div></blockquote>`

test('a code block keeps one word of its language', async () => {
  for (const read of [
    dropped,
    async (html: string) => (await pasted({ html })).markdown,
  ])
    expect(
      await read('<pre data-language="js more words"><code>let a</code></pre>'),
    ).toBe('```js\nlet a\n```\n')
})

test('a pasted callout keeps the title it shows and starts expanded', async () => {
  for (const read of [
    dropped,
    async (html: string) => (await pasted({ html })).markdown,
  ]) {
    expect(
      await read(callout('data-inkkit-title="Other text"', 'Shown title')),
    ).toBe('> [!NOTE] Shown title\n> Body [a](https://a.test)\n')
    expect(
      await read(callout('data-inkkit-title="A &amp;amp; B"', 'A &amp; B')),
    ).toBe('> [!NOTE] A &amp; B\n> Body [a](https://a.test)\n')
    expect(
      await read(
        callout('data-inkkit-fold="-" data-inkkit-title="Shown"', 'Shown'),
      ),
    ).toBe('> [!NOTE]+ Shown\n> Body [a](https://a.test)\n')
  }
  expect(
    (
      await pasted({
        html: withMarkdown(
          '> [!NOTE]- Shown\n> Body [a][]\n\n[a]: https://a.test\n',
          callout('data-inkkit-fold="-" data-inkkit-title="Shown"', 'Shown'),
        ),
      })
    ).markdown,
  ).toBe('> [!NOTE]+ Shown\n> Body [a][]\n\n[a]: https://a.test\n')
})

test('content a page does not show is left out of pasted HTML', async () => {
  expect(
    await fromHTML(
      '<p>a</p><noscript><p>alternative</p></noscript><template><p>inert</p></template><noembed><p>fallback</p></noembed><p>b</p>',
    ),
  ).toBe('a\n\nb\n')
  expect(
    await fromHTML(
      '<p>a<span hidden>one</span><span style="color: red; DISPLAY : None !important">two</span><span style="display:none" hidden>three</span><span style="display: inline">c</span></p><div hidden><p>four</p></div><x-note style="display: none">five</x-note>',
    ),
  ).toBe('ac\n')
})

test('a file embed copied with its HTML pastes as the image the HTML shows', async () => {
  expect(
    (
      await pasted(
        {
          html: withMarkdown(
            '![[other.png]] [a][]\n\n[a]: https://a.test\n',
            `<p><img src="${pixel}" alt="other.png"> ${linked('a', 'https://a.test', 'a')}</p>`,
          ),
        },
        adapter,
        false,
        true,
      )
    ).markdown,
  ).toBe('![other.png](images/photo.png) [a][]\n\n[a]: https://a.test\n')
})
