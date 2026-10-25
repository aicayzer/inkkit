import { expect, test } from '@playwright/test'
const moduleUrl = `/@fs${process.cwd()}/src/core.ts`
test('only the focused text surface paints an active retained selection', async ({
  page,
}, testInfo) => {
  await page.goto('/')
  await page.waitForFunction(() => Boolean(window.inkkitPlayground))
  await page.evaluate(async (moduleUrl) => {
    const { InkKitEditor } = await import(moduleUrl)
    document.body.replaceChildren()
    const editors = []
    for (const [index, text] of [
      'First café 😀',
      'Second paragraph',
    ].entries()) {
      const root = document.createElement('div')
      root.id = `selection-${index}`
      root.style.cssText =
        '--inkkit-selection-background:rgb(255, 0, 0);--inkkit-inactive-selection-background:rgb(0, 0, 255);padding:20px'
      document.body.append(root)
      const editor = await InkKitEditor.mount(root, { changed() {} })
      editor.loadDocument({
        documentId: text,
        generation: 1,
        format: 'md',
        text,
      })
      const snapshot = editor.textSnapshot()
      editor.selectTextRange(
        { snapshotId: snapshot.snapshotId, from: 0, to: 5 },
        { focus: true },
      )
      editors.push(editor)
    }
    Object.assign(window, { selectionEditors: editors })
  }, moduleUrl)
  const state = () =>
    page.evaluate(() =>
      Array.from(document.querySelectorAll('.inkkit-root'), (node) => ({
        active: node.classList.contains('inkkit-selection-active'),
        colour: getComputedStyle(
          node.querySelector('.ProseMirror')!,
          '::highlight(inkkit-selection)',
        ).backgroundColor,
      })),
    )
  const active = { active: true, colour: 'rgb(255, 0, 0)' }
  const inactive = { active: false, colour: 'rgb(0, 0, 255)' }
  await expect.poll(state).toEqual([inactive, active])
  await page.locator('#selection-0 .ProseMirror').focus()
  await expect.poll(state).toEqual([active, inactive])
  await page.screenshot({
    path: `_local/selection-formatted-${testInfo.project.name}.png`,
  })
  await page.evaluate(() => window.dispatchEvent(new Event('blur')))
  await expect.poll(state).toEqual([inactive, inactive])
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect.poll(state).toEqual([active, inactive])
  await page.evaluate(async () => {
    const editors = (
      window as unknown as {
        selectionEditors: import('../../src/core').InkKitEditor[]
      }
    ).selectionEditors
    editors[0]!.setEditingMode('source')
  })
  await page.locator('#selection-0 textarea').focus()
  await expect(page.locator('#selection-0')).toHaveClass(
    /inkkit-selection-active/,
  )
  expect(
    await page
      .locator('#selection-0 textarea')
      .evaluate(
        (node) => getComputedStyle(node, '::selection').backgroundColor,
      ),
  ).toBe('rgb(255, 0, 0)')
  await page.screenshot({
    path: `_local/selection-source-active-${testInfo.project.name}.png`,
  })
  await page.locator('#selection-1 .ProseMirror').focus()
  await expect(page.locator('#selection-0')).not.toHaveClass(
    /inkkit-selection-active/,
  )
  expect(
    await page
      .locator('#selection-0 textarea')
      .evaluate(
        (node) => getComputedStyle(node, '::selection').backgroundColor,
      ),
  ).toBe('rgb(0, 0, 255)')
  expect(
    await page
      .locator('#selection-0 textarea')
      .evaluate((node: HTMLTextAreaElement) => [
        node.selectionStart,
        node.selectionEnd,
      ]),
  ).toEqual([0, 5])
  await page.screenshot({
    path: `_local/selection-source-inactive-${testInfo.project.name}.png`,
  })
  await page.evaluate(() => {
    const editor = (
      window as unknown as {
        selectionEditors: import('../../src/core').InkKitEditor[]
      }
    ).selectionEditors[0]!
    editor.loadDocument({
      documentId: 'literal',
      generation: 2,
      format: 'txt',
      text: 'literal café 😀\r\nsecond',
    })
    const snapshot = editor.textSnapshot()
    editor.selectTextRange(
      { snapshotId: snapshot.snapshotId, from: 0, to: 7 },
      { focus: true },
    )
  })
  await expect(page.locator('#selection-0')).toHaveClass(
    /inkkit-selection-active/,
  )
  expect(
    await page
      .locator('#selection-0 textarea')
      .evaluate(
        (node) => getComputedStyle(node, '::selection').backgroundColor,
      ),
  ).toBe('rgb(255, 0, 0)')
  await page.screenshot({
    path: `_local/selection-txt-active-${testInfo.project.name}.png`,
  })
  await page.evaluate(async () => {
    for (const editor of (
      window as unknown as {
        selectionEditors: import('../../src/core').InkKitEditor[]
      }
    ).selectionEditors)
      await editor.destroy()
  })
  expect(
    await page.evaluate(
      () => Array.from(CSS.highlights.get('inkkit-selection') ?? []).length,
    ),
  ).toBe(0)
})
