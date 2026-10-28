import { test, expect, operation } from './fixtures'
import type { Page } from '@playwright/test'

// One document with every element InkKit draws that carries a class of its
// own: a code block with highlighting and a Copy button, a callout, a table,
// a task list, footnotes, comments, a wiki link, an image and a file card, and
// a block of Markdown that is kept as authored.
const everything = [
  '# Heading',
  '',
  'Text with a [[Notes/Trip|Trip]], a note.[^1] and <!-- an inline comment -->.',
  '',
  '> [!warning]- Folded',
  '> Body',
  '',
  '```js',
  'const a = 1',
  '```',
  '',
  '| A | B |',
  '| - | - |',
  '| 1 | 2 |',
  '',
  '- [ ] Task',
  '',
  '![A photo|140](images/photo.png)',
  '',
  '![[Document#page=1]]',
  '',
  '<div>Kept as authored</div>',
  '',
  '---',
  '',
  '[ref]: https://example.test',
  '',
  '[^1]: The note.',
  '',
].join('\n')

async function open(
  page: Page,
  openFixture: (fixture?: string) => Promise<void>,
  text = everything,
) {
  await openFixture('linked-files')
  await page.evaluate(
    (text) => window.inkkitPlayground.replaceDocument(text, 'md'),
    text,
  )
  // By role, so the wait does not depend on the classes under test.
  await expect(
    page.locator('.inkkit-root pre').getByRole('button', {
      name: 'Copy',
      exact: true,
    }),
  ).toHaveCount(1)
  await expect(page.locator('.inkkit-root img')).not.toHaveCount(0)
  await expect(page.locator('.inkkit-root td')).not.toHaveCount(0)
}

// The classes that ProseMirror, Milkdown and the table plugin add and read
// themselves.
const upstream = [
  /^ProseMirror(-[\w-]+)?$/,
  /^editor$/,
  /^milkdown(-[\w-]+)?$/,
  /^selectedCell$/,
]
const inkkit = /^inkkit-[\w-]+$/

test('rendered classes keep their prefixes and styles @linked-files', async ({
  page,
  openFixture,
}) => {
  await open(page, openFixture)
  await test.step('runtime class inventory', async () => {
    const classes = await page.evaluate(() => {
      const found = new Set<string>()
      for (const element of document.querySelectorAll('.inkkit-root *'))
        if (!element.closest('svg'))
          for (const name of element.classList) found.add(name)
      return [...found]
    })
    expect(classes).toEqual(
      expect.arrayContaining([
        'inkkit-copy',
        'inkkit-image',
        'inkkit-image-handle',
        'inkkit-literal-markdown',
        'inkkit-hljs-keyword',
      ]),
    )
    expect(
      classes.filter(
        (name) =>
          !inkkit.test(name) && !upstream.some((pattern) => pattern.test(name)),
      ),
    ).toEqual([])
  })
  await test.step('computed styles', async () => {
    const styles = await page.evaluate(() => {
      const style = (selector: string, property: string) =>
        getComputedStyle(document.querySelector(selector)!).getPropertyValue(
          property,
        )
      return {
        copy: style('.inkkit-root pre .inkkit-copy', 'position'),
        card: style('.inkkit-root .inkkit-image', 'position'),
        grip: style('.inkkit-root .inkkit-image-handle', 'cursor'),
        literal: style(
          '.inkkit-root pre.inkkit-literal-markdown',
          'white-space',
        ),
        keyword: style('.inkkit-root .inkkit-hljs-keyword', 'color'),
        code: style('.inkkit-root pre code', 'color'),
      }
    })
    expect(styles).toMatchObject({
      copy: 'absolute',
      card: 'relative',
      grip: 'col-resize',
      literal: 'pre-wrap',
    })
    expect(styles.keyword).not.toBe(styles.code)
  })
})

test('the placeholder and an absent image carry prefixed classes @linked-files', async ({
  page,
  openFixture,
}) => {
  await openFixture('linked-files')
  await page.evaluate(() => window.inkkitPlayground.replaceDocument('', 'md'))
  const empty = page.locator('.inkkit-root .ProseMirror .inkkit-empty')
  await expect(empty).toHaveCount(1)
  await expect(empty).toHaveAttribute('data-placeholder', /.+/)
  expect(
    await empty.evaluate((element) => getComputedStyle(element).position),
  ).toBe('relative')
  expect(
    await empty.evaluate(
      (element) => getComputedStyle(element, '::before').content,
    ),
  ).toMatch(/\w/)
  await expect(page.locator('.inkkit-root [class~="empty"]')).toHaveCount(0)
})

test('copied HTML carries only InkKit’s own classes, none of the renamed ones @linked-files', async ({
  page,
  openFixture,
}) => {
  await open(page, openFixture)
  const output = (await operation(page, 'clipboard')) as { html: string }
  const classes = await page.evaluate((html) => {
    const template = document.createElement('template')
    template.innerHTML = html
    return [
      ...new Set(
        [...template.content.querySelectorAll('[class]')].flatMap((element) => [
          ...element.classList,
        ]),
      ),
    ].sort()
  }, output.html)
  expect(classes).toContain('inkkit-literal-markdown')
  expect(classes.filter((name) => !inkkit.test(name))).toEqual([])
  expect(output.html).not.toMatch(/inkkit-(copy|image-handle|hljs)/)
})

test('printable HTML keeps its short list of classes @linked-files', async ({
  page,
  openFixture,
}) => {
  await open(page, openFixture)
  const print = (await operation(page, 'printable')) as { html: string }
  const classes = await page.evaluate((html) => {
    const template = document.createElement('template')
    template.innerHTML = html
    return [
      ...new Set(
        [...template.content.querySelectorAll('[class]')].flatMap((element) => [
          ...element.classList,
        ]),
      ),
    ].sort()
  }, print.html)
  expect(classes.filter((name) => !inkkit.test(name))).toEqual([])
  expect(classes).not.toContain('inkkit-literal-markdown')
})

const legacy: Record<string, string> = {
  '--accent': 'rgb(255, 0, 0)',
  '--text': 'rgb(0, 128, 0)',
  '--muted': 'rgb(0, 0, 255)',
  '--rule': 'rgb(255, 0, 255)',
  '--code-bg': 'rgb(255, 255, 0)',
  '--mono': 'Courier',
  '--reading-width': '10rem',
  '--default-cell-min-width': '300px',
}

// What the legacy names used to reach: the accent, text, muted, rule, code
// background and monospace font, each read from a different element.
const probe = (page: Page) =>
  page.evaluate(() => {
    const read = (
      selector: string,
      pseudo: string | null,
      ...props: string[]
    ) => {
      const element = document.querySelector(selector)!
      const style = getComputedStyle(element, pseudo)
      return props.map((name) => style.getPropertyValue(name))
    }
    return {
      root: read('.inkkit-root', null, 'color'),
      surface: read(
        '.inkkit-root .ProseMirror',
        null,
        'caret-color',
        'padding-left',
        'padding-right',
      ),
      pre: read('.inkkit-root pre', null, 'background-color', 'font-family'),
      cell: read('.inkkit-root td', null, 'min-width'),
      rule: read('.inkkit-root hr', null, 'border-top-color'),
      copy: read('.inkkit-root .inkkit-copy', null, 'color'),
      callout: read(
        '.inkkit-root .inkkit-callout',
        null,
        'border-inline-start-color',
      ),
      plain: read('.inkkit-root .inkkit-plain', null, 'font-family', 'color'),
      note: read(
        '.inkkit-root .inkkit-footnote-definition',
        null,
        'border-inline-start-color',
      ),
    }
  })

test('inherited legacy names no longer change the editor @linked-files', async ({
  page,
  openFixture,
}) => {
  await open(page, openFixture)
  const before = await probe(page)
  await page.evaluate((legacy) => {
    for (const [name, value] of Object.entries(legacy))
      document.documentElement.style.setProperty(name, value)
  }, legacy)
  expect(await probe(page)).toEqual(before)
  // The same names set on the root itself change nothing either.
  await page.evaluate((legacy) => {
    const root = document.querySelector<HTMLElement>('.inkkit-root')!
    for (const [name, value] of Object.entries(legacy))
      root.style.setProperty(name, value)
  }, legacy)
  expect(await probe(page)).toEqual(before)
})

test('the prefixed tokens still change the editor @linked-files', async ({
  page,
  openFixture,
}) => {
  await open(page, openFixture)
  const before = await probe(page)
  await page.addStyleTag({
    content:
      '#editor { --inkkit-accent-color: rgb(255, 0, 0); --inkkit-text-color: rgb(0, 128, 0); --inkkit-rule-color: rgb(255, 0, 255); --inkkit-code-background: rgb(255, 255, 0); --inkkit-monospace-font: Courier; }',
  })
  const after = await probe(page)
  expect(after.surface[0]).toBe('rgb(255, 0, 0)')
  expect(after.root[0]).toBe('rgb(0, 128, 0)')
  expect(after.rule[0]).toBe('rgb(255, 0, 255)')
  expect(after.pre[0]).toBe('rgb(255, 255, 0)')
  expect(after.pre[1]).toContain('Courier')
  expect(after).not.toEqual(before)
})

// The column's inset in each surface, and in a header the host draws above
// the editor with the same token.
const insets = (page: Page) =>
  page.evaluate(() => {
    const pad = (selector: string) => {
      const style = getComputedStyle(document.querySelector(selector)!)
      return [style.paddingLeft, style.paddingRight].map(parseFloat)
    }
    const width = (selector: string) =>
      document.querySelector(selector)!.clientWidth
    return {
      formatted: pad('.inkkit-root .ProseMirror'),
      plain: pad('.inkkit-root .inkkit-plain'),
      header: document.querySelector('#column-header')
        ? pad('#column-header')
        : [],
      editor: width('.inkkit-root'),
    }
  })

const addHeader = (page: Page) =>
  page.evaluate(() => {
    const header = document.createElement('div')
    header.id = 'column-header'
    header.textContent = 'Host header'
    document.getElementById('editor')!.before(header)
  })

test('source mode and the formatted surface share one writing column, which a host header can match @linked-files', async ({
  page,
  openFixture,
}) => {
  await open(page, openFixture)
  await addHeader(page)
  await page.addStyleTag({
    content: `
      #editors { display: block; }
      #editor, #column-header { box-sizing: border-box; width: 100%; border: 0; }
      body { --inkkit-reading-width: 30rem; --inkkit-padding-inline: 20px; }
      /* The formula docs/reference/appearance.mdx gives as the default of --inkkit-column-inset. */
      #column-header {
        padding-inline: max(
          var(--inkkit-padding-inline),
          calc((100% - var(--inkkit-reading-width)) / 2 + var(--inkkit-padding-inline))
        );
      }`,
  })
  const formatted = await insets(page)
  // The column is the reading width, centred, with the padding inside it.
  const inset = (formatted.editor - 480) / 2 + 20
  expect(formatted.editor).toBeGreaterThan(520)
  expect(formatted.formatted[0]).toBeCloseTo(inset, 0)
  expect(formatted.formatted[1]).toBeCloseTo(inset, 0)
  expect(formatted.header).toEqual(formatted.formatted)
  await operation(page, 'editingMode', { mode: 'source' })
  await expect(page.locator('.inkkit-root .inkkit-plain')).toBeVisible()
  const source = await insets(page)
  expect(source.plain).toEqual(formatted.formatted)
  expect(source.header).toEqual(formatted.formatted)
})

test('the column inset is a token a host sets once and reads in its own header @linked-files', async ({
  page,
  openFixture,
}) => {
  await open(page, openFixture)
  await addHeader(page)
  await page.addStyleTag({
    content: `
      #editors { display: block; }
      #editor, #column-header { box-sizing: border-box; width: 100%; }
      body { --inkkit-column-inset: 77px; }
      #column-header { padding-inline: var(--inkkit-column-inset); }`,
  })
  for (const mode of ['formatted', 'source'] as const) {
    await operation(page, 'editingMode', { mode })
    const { formatted, plain, header } = await insets(page)
    expect(header).toEqual([77, 77])
    expect(mode === 'formatted' ? formatted : plain).toEqual([77, 77])
  }
})
