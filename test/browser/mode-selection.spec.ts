import { expect, test, type Page } from '@playwright/test'
import type { InkKitEditor } from '../../src/core'

declare global {
  interface Window {
    modeEditor: InkKitEditor
  }
}
const moduleUrl = `/@fs${process.cwd()}/src/core.ts`
async function mount(page: Page, text: string) {
  await page.goto('/')
  await page.waitForFunction(() => Boolean(window.inkkitPlayground))
  await page.evaluate(
    async ({ moduleUrl, text }) => {
      const { InkKitEditor } = (await import(
        moduleUrl
      )) as typeof import('../../src/core')
      for (const child of Array.from(document.body.children))
        if (child instanceof HTMLElement) child.style.display = 'none'
      const root = document.createElement('div')
      root.id = 'mode-editor'
      root.style.cssText =
        'position:fixed;inset:20px;padding:20px;overflow:auto;background:white'
      document.body.append(root)
      window.modeEditor = await InkKitEditor.mount(root, { changed() {} })
      window.modeEditor.loadDocument({
        documentId: 'modes',
        generation: 1,
        format: 'md',
        text,
      })
    },
    { moduleUrl, text },
  )
}

test('repeated text in hidden comments does not capture the visible caret', async ({
  page,
}) => {
  const text = '<!-- repeated -->\n\n%% repeated %%\n\nrepeated\n'
  await mount(page, text)
  await page.evaluate(() => {
    const editor = window.modeEditor
    const snapshot = editor.textSnapshot()
    editor.selectTextRange(
      { snapshotId: snapshot.snapshotId, from: 3, to: 3 },
      { focus: true },
    )
    editor.setEditingMode('source')
  })
  expect(
    await page
      .locator('#mode-editor textarea')
      .evaluate((node: HTMLTextAreaElement) => node.selectionStart),
  ).toBe(text.lastIndexOf('repeated') + 3)
})

test('mode switches preserve a middle caret, reveal it and undo at the edit', async ({
  page,
}) => {
  const text = Array.from(
    { length: 120 },
    (_, index) =>
      `Paragraph ${index + 1}: café 😀 **word** and [link](https://example.com).`,
  ).join('\r\n\r\n')
  await mount(page, text)
  const sourceAt =
    text.indexOf('Paragraph 60') + 'Paragraph 60: café 😀 '.length
  const before = await page.evaluate(() => {
    const editor = window.modeEditor
    const snapshot = editor.textSnapshot()
    const from =
      snapshot.text.indexOf('Paragraph 60') + 'Paragraph 60: café 😀 '.length
    editor.selectTextRange(
      { snapshotId: snapshot.snapshotId, from, to: from },
      { focus: true, reveal: true },
    )
    return from
  })
  await page.keyboard.type('typed ')
  await page.evaluate(() => window.modeEditor.setEditingMode('source'))
  const literal = page.locator('#mode-editor textarea')
  await expect(literal).toBeFocused()
  expect(
    await literal.evaluate((node: HTMLTextAreaElement) => node.selectionStart),
  ).toBe(text.slice(0, sourceAt).replace(/\r\n/g, '\n').length + 6)
  expect(
    await literal.evaluate((node: HTMLTextAreaElement) => node.scrollTop),
  ).toBeGreaterThan(100)
  await page.evaluate(() => window.modeEditor.setEditingMode('formatted'))
  expect(
    await page.evaluate(() => window.modeEditor.textSnapshot().selection.from),
  ).toBe(before + 6)
  expect(
    await page.locator('#mode-editor').evaluate((node) => node.scrollTop),
  ).toBeGreaterThan(100)
  expect(await page.evaluate(() => window.modeEditor.undo())).toBe(true)
  expect(await page.evaluate(() => window.modeEditor.snapshot().text)).toBe(
    text,
  )
  expect(
    await page.evaluate(() => window.modeEditor.textSnapshot().selection.from),
  ).toBe(before)
  expect(
    await page.locator('#mode-editor').evaluate((node) => node.scrollTop),
  ).toBeGreaterThan(100)
})

test('visible literal Markdown keeps its source caret through mode changes', async ({
  page,
}) => {
  const text = '---\r\ntitle: Visible frontmatter\r\n---\r\n\r\nAfter\r\n'
  await mount(page, text)
  const before = await page.evaluate(() => {
    const editor = window.modeEditor
    const snapshot = editor.textSnapshot()
    const from = snapshot.text.indexOf('Visible') + 3
    editor.selectTextRange(
      { snapshotId: snapshot.snapshotId, from, to: from },
      { focus: true },
    )
    editor.setEditingMode('source')
    return from
  })
  expect(
    await page
      .locator('#mode-editor textarea')
      .evaluate((node: HTMLTextAreaElement) => node.selectionStart),
  ).toBe(text.replace(/\r\n/g, '\n').indexOf('Visible') + 3)
  await page.evaluate(() => window.modeEditor.setEditingMode('formatted'))
  expect(
    await page.evaluate(() => window.modeEditor.textSnapshot().selection.from),
  ).toBe(before)
  expect(await page.evaluate(() => window.modeEditor.snapshot().text)).toBe(
    text,
  )
})

test('selection mapping preserves untidy source and formatted selection across markup', async ({
  page,
}) => {
  const text =
    '\uFEFF# Heading\r\n\r\n+ café &amp; **bold 😀** and [label](destination)\r\n\r\n[unused]: elsewhere\r\n'
  await mount(page, text)
  const selection = await page.evaluate(() => {
    const editor = window.modeEditor
    const snapshot = editor.textSnapshot()
    const from = snapshot.text.indexOf('bold'),
      to = snapshot.text.indexOf('label') + 5
    editor.selectTextRange(
      { snapshotId: snapshot.snapshotId, from, to },
      { focus: true },
    )
    editor.setEditingMode('source')
    return {
      from,
      to,
      selected: editor
        .textSnapshot()
        .text.slice(
          editor.textSnapshot().selection.from,
          editor.textSnapshot().selection.to,
        ),
    }
  })
  expect(selection.selected).toBe('bold 😀** and [label')
  await page.evaluate(() => window.modeEditor.setEditingMode('formatted'))
  const result = await page.evaluate(() => ({
    selection: window.modeEditor.textSnapshot().selection,
    text: window.modeEditor.snapshot().text,
  }))
  expect(result.selection.from).toBe(selection.from)
  expect(result.selection.to).toBe(selection.to)
  expect(result.text).toBe(text)
})

test('an unfocused mode switch keeps the reading position away from the stale caret', async ({
  page,
}) => {
  await mount(
    page,
    Array.from({ length: 120 }, (_, index) => `Paragraph ${index + 1}`).join(
      '\n\n',
    ),
  )
  await page.evaluate(() => {
    const root = document.querySelector<HTMLElement>('#mode-editor')!
    root.scrollTop = (root.scrollHeight - root.clientHeight) / 2
    window.modeEditor.setEditingMode('source')
  })
  const ratio = await page
    .locator('#mode-editor textarea')
    .evaluate(
      (node: HTMLTextAreaElement) =>
        node.scrollTop / (node.scrollHeight - node.clientHeight),
    )
  expect(ratio).toBeGreaterThan(0.45)
  expect(ratio).toBeLessThan(0.55)
  await page.evaluate(() => window.modeEditor.setEditingMode('formatted'))
  const formattedRatio = await page
    .locator('#mode-editor')
    .evaluate(
      (node) => node.scrollTop / (node.scrollHeight - node.clientHeight),
    )
  expect(formattedRatio).toBeGreaterThan(0.45)
  expect(formattedRatio).toBeLessThan(0.55)
})

test('a source caret inside a folded callout maps into its visible body', async ({
  page,
}) => {
  const text = '> [!NOTE]- Details\n> hidden café 😀 body\n\nAfter\n'
  await mount(page, text)
  await page.evaluate(() => {
    const editor = window.modeEditor
    editor.setEditingMode('source')
    const snapshot = editor.textSnapshot()
    const from = snapshot.text.indexOf('café') + 'café 😀'.length
    editor.selectTextRange(
      { snapshotId: snapshot.snapshotId, from, to: from },
      { focus: true },
    )
    editor.setEditingMode('formatted')
  })
  const snapshot = await page.evaluate(() => window.modeEditor.textSnapshot())
  expect(snapshot.selection.from).toBe(
    snapshot.text.indexOf('café') + 'café 😀'.length,
  )
  await expect(
    page
      .locator('#mode-editor')
      .getByText('hidden café 😀 body', { exact: true }),
  ).toBeVisible()
  expect(await page.evaluate(() => window.modeEditor.snapshot().text)).toBe(
    text,
  )
})

test('switching after literal typing maps the new caret without another edit', async ({
  page,
}) => {
  const text = 'First\r\n\r\n+ middle **word**\r\n\r\nLast\r\n'
  await mount(page, text)
  await page.evaluate(() => {
    const editor = window.modeEditor
    editor.setEditingMode('source')
    const snapshot = editor.textSnapshot()
    const from = snapshot.text.indexOf('word') + 2
    editor.selectTextRange(
      { snapshotId: snapshot.snapshotId, from, to: from },
      { focus: true },
    )
  })
  await page.keyboard.insertText('😀')
  const before = await page.evaluate(() => window.modeEditor.snapshot())
  await page.evaluate(() => window.modeEditor.setEditingMode('formatted'))
  const snapshot = await page.evaluate(() => window.modeEditor.textSnapshot())
  expect(snapshot.selection.from).toBe(
    snapshot.text.indexOf('wo😀rd') + 'wo😀'.length,
  )
  const after = await page.evaluate(() => window.modeEditor.snapshot())
  expect(after.text).toBe(before.text)
  expect(after.revision).toBe(before.revision)
})

for (const [name, text] of [
  ['multiline inline code', 'Before ` alpha\r\nbeta ` after\r\n'],
  [
    'quoted fenced code',
    '> ```js\r\n> alpha\r\n> beta\r\n> ```\r\n\r\nAfter\r\n',
  ],
  [
    'list fenced code',
    '- Item\r\n\r\n  ```js\r\n  alpha\r\n  beta\r\n  ```\r\n',
  ],
]) {
  test(`${name} preserves the caret through source and formatted mode`, async ({
    page,
  }) => {
    await mount(page, text!)
    const result = await page.evaluate(() => {
      const editor = window.modeEditor
      editor.setEditingMode('source')
      const source = editor.textSnapshot()
      const at = source.text.indexOf('beta') + 2
      editor.selectTextRange(
        { snapshotId: source.snapshotId, from: at, to: at },
        { focus: true },
      )
      editor.setEditingMode('formatted')
      const formatted = editor.textSnapshot()
      const expected = formatted.text.indexOf('beta') + 2
      const actual = formatted.selection.from
      editor.setEditingMode('source')
      return {
        actual,
        expected,
        sourceAt: editor.textSnapshot().selection.from,
        at,
        text: editor.snapshot().text,
      }
    })
    expect(result.actual).toBe(result.expected)
    expect(result.sourceAt).toBe(result.at)
    expect(result.text).toBe(text)
  })
}
