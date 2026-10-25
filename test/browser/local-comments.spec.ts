import { test, expect, observe, operation } from './fixtures'
for (const action of ['copy', 'cut'])
  for (const mode of ['formatted', 'source'])
    for (const visible of [false, true])
      for (const source of [
        'One <!-- private inline --> two.\n',
        'One %%private inline%% two.\n',
        '<div>Visible <!-- private --> tail</div>\n',
        'One\n\n<!-- private block -->\n\nTwo\n',
        'One\n\n%%\nprivate block\n%%\n\nTwo\n',
      ])
        test(`local ${action} keeps comments (${mode}, ${visible}, ${JSON.stringify(source)})`, async ({
          page,
          openFixture,
        }) => {
          await openFixture()
          await operation(page, 'replaceSource', { text: source })
          await operation(page, 'editingMode', { mode })
          await operation(page, 'commentsVisible', { visible })
          await page
            .locator(
              mode === 'source'
                ? 'textarea.inkkit-plain'
                : '.ProseMirror.editor',
            )
            .click()
          await page.keyboard.press('ControlOrMeta+a')
          const copied = await page.evaluate((action) => {
            const data = new DataTransfer()
            document.activeElement!.dispatchEvent(
              new ClipboardEvent(action, {
                clipboardData: data,
                bubbles: true,
                cancelable: true,
              }),
            )
            return {
              text: data.getData('text/plain'),
              html: data.getData('text/html'),
            }
          }, action)
          expect(copied.text).not.toContain('private')
          expect(copied.html).not.toContain('private')
          await page.evaluate((copied) => {
            const data = new DataTransfer()
            data.setData('text/plain', copied.text)
            data.setData('text/html', copied.html)
            document.activeElement!.dispatchEvent(
              new ClipboardEvent('paste', {
                clipboardData: data,
                bubbles: true,
                cancelable: true,
              }),
            )
          }, copied)
          await expect
            .poll(async () => (await observe(page)).snapshot?.text)
            .toBe(source)
          await operation(page, 'undo')
          await operation(page, 'redo')
          await expect
            .poll(async () => (await observe(page)).snapshot?.text)
            .toBe(source)
          await operation(page, 'reload')
          expect((await observe(page)).snapshot?.text).toBe(source)
        })

async function selectedCopy(
  page: import('@playwright/test').Page,
  source: string,
  mode = 'formatted',
) {
  await operation(page, 'replaceSource', { text: source })
  await operation(page, 'editingMode', { mode })
  await page
    .locator(
      mode === 'source' ? 'textarea.inkkit-plain' : '.ProseMirror.editor',
    )
    .click()
  await page.keyboard.press('ControlOrMeta+a')
  const { text, html } = (await operation(page, 'clipboard', {
    scope: 'selection',
  })) as { text: string; html: string }
  return { text, html }
}

test('local snapshot copy repeats, honours explicit input, and expires on reload', async ({
  page,
  openFixture,
}) => {
  await openFixture()
  const source = 'One <!-- private --> two.\n'
  const copied = await selectedCopy(page, source)
  expect(copied.html).not.toContain('private')
  await operation(page, 'paste', { input: copied })
  expect((await observe(page)).snapshot?.text).toBe(source)
  await page.keyboard.press('ControlOrMeta+a')
  await operation(page, 'paste', { input: copied })
  expect((await observe(page)).snapshot?.text).toBe(source)
  await page.keyboard.press('ControlOrMeta+a')
  await operation(page, 'paste', {
    input: { ...copied, markdown: 'Explicit\n' },
  })
  expect((await observe(page)).snapshot?.text).toBe('Explicit\n')
  await operation(page, 'reload', { text: '' })
  await operation(page, 'paste', { input: copied })
  expect((await observe(page)).snapshot?.text).not.toContain('private')
})

test('source clipboard snapshot retains exact partial source and comment-only content', async ({
  page,
  openFixture,
}) => {
  await openFixture()
  const source = 'Keep one <!-- private --> two tail\r\n'
  await selectedCopy(page, source, 'source')
  await page
    .locator('textarea.inkkit-plain')
    .evaluate((element: HTMLTextAreaElement) =>
      element.setSelectionRange(5, 31),
    )
  const { text, html } = (await operation(page, 'clipboard', {
    scope: 'selection',
  })) as { text: string; html: string }
  const selected = { text, html }
  await operation(page, 'paste', { input: selected })
  expect((await observe(page)).snapshot?.text).toBe(source)
  const comment = '<!-- private -->\n'
  const copied = await selectedCopy(page, comment, 'source')
  expect(copied.text).not.toContain('private')
  expect(copied.html).not.toContain('private')
  await operation(page, 'paste', { input: copied })
  expect((await observe(page)).snapshot?.text).toBe(comment)
})

test('a changed clipboard and another editor cannot recover private comments', async ({
  page,
  context,
  openFixture,
}) => {
  await openFixture()
  const copied = await selectedCopy(page, 'One <!-- private --> two.\n')
  await operation(page, 'paste', { input: { ...copied, text: 'replacement' } })
  expect((await observe(page)).snapshot?.text).not.toContain('private')
  const other = await context.newPage()
  await other.goto('/?fixture=everyday&configuration=rich')
  await expect
    .poll(() =>
      other.evaluate(() => !!window.inkkitPlayground?.observe().snapshot),
    )
    .toBe(true)
  await operation(other, 'replaceSource', { text: '' })
  await operation(other, 'paste', { input: copied })
  expect((await observe(other)).snapshot?.text).not.toContain('private')
  await other.close()
})

test('local copy respects read-only, composition and replacement guards', async ({
  page,
  openFixture,
}) => {
  await openFixture()
  const source = 'One <!-- private --> two.\n'
  const copied = await selectedCopy(page, source)
  const before = (await observe(page)).snapshot
  await operation(page, 'editable', { editable: false })
  await expect(operation(page, 'paste', { input: copied })).rejects.toThrow()
  expect((await observe(page)).snapshot).toEqual(before)
  await operation(page, 'editable', { editable: true })
  await page
    .locator('.ProseMirror.editor')
    .dispatchEvent('compositionstart', { data: 'あ' })
  await expect(operation(page, 'paste', { input: copied })).rejects.toThrow()
  await page
    .locator('.ProseMirror.editor')
    .dispatchEvent('compositionend', { data: '' })
  await expect.poll(async () => (await observe(page)).snapshot).toEqual(before)
  await operation(page, 'replaceSource', { text: '' })
  await operation(page, 'paste', { input: copied })
  expect((await observe(page)).snapshot?.text).not.toContain('private')
})

test('an unwritten private snapshot does not replace the actual clipboard association', async ({
  page,
  openFixture,
}) => {
  await openFixture()
  const source = 'One <!-- private --> two. Another <!-- other --> end.\n'
  await selectedCopy(page, source, 'source')
  const copied = await page.evaluate(() => {
    const data = new DataTransfer()
    document.activeElement!.dispatchEvent(
      new ClipboardEvent('copy', {
        clipboardData: data,
        bubbles: true,
        cancelable: true,
      }),
    )
    return { text: data.getData('text/plain'), html: data.getData('text/html') }
  })
  await page
    .locator('textarea.inkkit-plain')
    .evaluate((element: HTMLTextAreaElement) =>
      element.setSelectionRange(0, 25),
    )
  const first = (await operation(page, 'clipboard', {
    scope: 'selection',
  })) as { html: string }
  const second = (await operation(page, 'clipboard', {
    scope: 'selection',
  })) as { html: string }
  expect(second.html).toBe(first.html)
  expect(first.html).not.toBe(copied.html)
  await page.keyboard.press('ControlOrMeta+a')
  await operation(page, 'paste', { input: copied })
  expect((await observe(page)).snapshot?.text).toBe(source)
})
