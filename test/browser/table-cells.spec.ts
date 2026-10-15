import { test, expect, observe, operation, caretAfterMatch } from './fixtures'

test('typing spaces beside an image and formatted text in a table cell saves spaces', async ({
  page,
  openFixture,
}) => {
  await openFixture('images')
  await page.evaluate(() =>
    window.inkkitPlayground.replaceDocument(
      '| Name | Other |\n| --- | --- |\n| Tiny![a](images/native.png)tail | **bold**word |\n',
      'md',
    ),
  )
  await expect(page.locator('.ProseMirror td img').first()).toBeVisible()
  const typeSpace = async (text: string, key: 'ArrowLeft' | 'ArrowRight') => {
    await operation(page, 'find', { text })
    await page.keyboard.press(key)
    await page.keyboard.type(' ')
  }
  await typeSpace('Tiny', 'ArrowRight')
  await typeSpace('tail', 'ArrowLeft')
  await typeSpace('word', 'ArrowLeft')
  await typeSpace('word', 'ArrowRight')
  const saved = (await observe(page)).snapshot!.text
  expect(saved).toBe(
    '| Name | Other |\n| --- | --- |\n| Tiny ![a](images/native.png) tail | **bold** word&#x20; |\n',
  )
  await page.evaluate(
    (text) => window.inkkitPlayground.replaceDocument(text, 'md'),
    saved,
  )
  expect((await observe(page)).snapshot!.text).toBe(saved)
})

// Each edit lands in the middle of a cell's text, so the arrow key collapses the found text.
const tables = [
  {
    name: 'a line break in a cell',
    source:
      '| Name | Other |\n| --- | --- |\n| xx<br>yy | aa <br/> bb |\n| qqq | rr |\n',
    find: 'qq',
    saved:
      '| Name | Other |\n| --- | --- |\n| xx<br>yy | aa <br/> bb |\n| qq Zq | rr |\n',
  },
  {
    name: 'an empty cell',
    source: '| Name | Other |\n| --- | --- |\n| xx |  |\n| qqq | rr |\n',
    find: 'qq',
    saved: '| Name | Other |\n| --- | --- |\n| xx |  |\n| qq Zq | rr |\n',
  },
  {
    name: 'a short row',
    source: '| Name | Other |\n| --- | --- |\n| xxx |\n| qq | rr |\n',
    find: 'xx',
    saved: '| Name | Other |\n| --- | --- |\n| xx Zx |\n| qq | rr |\n',
  },
  {
    name: 'a row longer than its header',
    source: '| Name | Other |\n| --- | --- |\n| `p | q` | rrr |\n',
    find: 'rr',
    saved: '| Name | Other |\n| --- | --- |\n| `p | q` | rr Zr |\n',
  },
]

for (const table of tables)
  test(`typing in a table with ${table.name} keeps its source, and Undo restores it`, async ({
    page,
    openFixture,
  }) => {
    await openFixture()
    await page.evaluate(
      (text) => window.inkkitPlayground.replaceDocument(text, 'md'),
      table.source,
    )
    await caretAfterMatch(page, table.find)
    await page.keyboard.type(' Z')
    await expect
      .poll(async () => (await observe(page)).snapshot!.text)
      .toBe(table.saved)
    for (let step = 0; step < 3; step++)
      await page.keyboard.press('ControlOrMeta+z')
    await expect
      .poll(async () => (await observe(page)).snapshot)
      .toMatchObject({ text: table.source, dirty: false })
  })

test('Shift-Enter in a table cell saves a <br /> line break', async ({
  page,
  openFixture,
}) => {
  await openFixture()
  const source = '| Name | Other |\n| --- | --- |\n| xxyy | rr |\n'
  await page.evaluate(
    (text) => window.inkkitPlayground.replaceDocument(text, 'md'),
    source,
  )
  await caretAfterMatch(page, 'xx')
  await page.keyboard.press('Shift+Enter')
  const saved = '| Name | Other |\n| --- | --- |\n| xx<br />yy | rr |\n'
  await expect
    .poll(async () => (await observe(page)).snapshot!.text)
    .toBe(saved)
  await expect(page.locator('.ProseMirror td br')).toHaveCount(1)
  await page.evaluate(
    (text) => window.inkkitPlayground.replaceDocument(text, 'md'),
    saved,
  )
  expect((await observe(page)).snapshot!.text).toBe(saved)
})

test('repeated Shift-Enter at the start, middle and end of table cells keeps the table shape', async ({
  page,
  openFixture,
}) => {
  await openFixture()
  const source = '| Name | Other |\n| --- | --- |\n| xxyy | rr<br> |\n'
  await page.evaluate(
    (text) => window.inkkitPlayground.replaceDocument(text, 'md'),
    source,
  )
  // The caret is placed through the API so that only the key presses under test move it.
  const breakTwice = async (text: string, offset: number) => {
    const snapshot = (await operation(page, 'textSnapshot')) as {
      snapshotId: string
      text: string
    }
    const at = snapshot.text.indexOf(text) + offset
    await operation(page, 'selectTextRange', {
      range: { snapshotId: snapshot.snapshotId, from: at, to: at },
    })
    await operation(page, 'focus')
    await page.keyboard.press('Shift+Enter')
    await page.keyboard.press('Shift+Enter')
  }
  await breakTwice('xx', 0)
  await breakTwice('yy', 0)
  // After the authored break that ends the cell.
  await breakTwice('rr', 3)
  const saved =
    '| Name | Other |\n| --- | --- |\n| <br /><br />xx<br /><br />yy | rr<br><br /><br /> |\n'
  await expect
    .poll(async () => (await observe(page)).snapshot!.text)
    .toBe(saved)
  await expect(page.locator('.ProseMirror tr')).toHaveCount(2)
  await expect(page.locator('.ProseMirror td')).toHaveCount(2)
  for (let step = 0; step < 8; step++)
    await page.keyboard.press('ControlOrMeta+z')
  await expect
    .poll(async () => (await observe(page)).snapshot)
    .toMatchObject({ text: source, dirty: false })
})

test('Shift-Enter inside and beside formatted text in a table cell saves a plain break', async ({
  page,
  openFixture,
}) => {
  await openFixture()
  const source =
    '| Name | Other |\n| --- | --- |\n| **bold** x | [link](https://e.com) _it_ |\n'
  await page.evaluate(
    (text) => window.inkkitPlayground.replaceDocument(text, 'md'),
    source,
  )
  const breakAt = async (text: string, offset: number) => {
    const snapshot = (await operation(page, 'textSnapshot')) as {
      snapshotId: string
      text: string
    }
    const at = snapshot.text.indexOf(text) + offset
    await operation(page, 'selectTextRange', {
      range: { snapshotId: snapshot.snapshotId, from: at, to: at },
    })
    await operation(page, 'focus')
    await page.keyboard.press('Shift+Enter')
  }
  await breakAt('bold', 2)
  await breakAt('link', 4)
  await breakAt('it', 0)
  const saved =
    '| Name | Other |\n| --- | --- |\n| **bo**<br />**ld** x | [link](https://e.com)<br /> <br />_it_ |\n'
  await expect
    .poll(async () => (await observe(page)).snapshot!.text)
    .toBe(saved)
  for (let step = 0; step < 4; step++)
    await page.keyboard.press('ControlOrMeta+z')
  await expect
    .poll(async () => (await observe(page)).snapshot)
    .toMatchObject({ text: source, dirty: false })
})
