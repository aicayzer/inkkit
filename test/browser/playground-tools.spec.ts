import { test, expect, observe, operation } from './fixtures'
import { fixtures } from '../../scripts/interop/consumer/fixtures'

const source = (page: import('@playwright/test').Page) =>
  page.getByRole('textbox', { name: 'Markdown source editor' })
// The page sets up the playground after it loads, so this reads nothing until
// then instead of failing.
const openedDocument = (page: import('@playwright/test').Page) =>
  page.evaluate(() => window.inkkitPlayground?.observe().snapshot?.documentId)

test('an unknown fixture shows an error on the page and still opens @playground-tools', async ({
  page,
}) => {
  await page.goto('/?fixture=nope&configuration=wide&adapter=slow')
  const problems = page.getByRole('alert')
  await expect(problems).toContainText('Unknown fixture "nope"')
  await expect(problems).toContainText('Unknown configuration "wide"')
  await expect(problems).toContainText('Unknown adapter "slow"')
  await expect.poll(() => openedDocument(page)).toBe('fixture:everyday')
  await page.locator('#fixture').selectOption('tables')
  await expect(problems).toBeHidden()
})

test('a bad generator is reported and a good one builds a document @playground-tools', async ({
  page,
}) => {
  await page.goto('/?generate=lines:5')
  await expect(page.getByRole('alert')).toContainText('Unknown generator')
  await page.goto('/?generate=paragraphs:300')
  await expect.poll(() => openedDocument(page)).toBe('generated:paragraphs:300')
  const snapshot = (await observe(page)).snapshot!
  expect(snapshot.text.match(/^Paragraph /gm)?.length).toBeGreaterThan(280)
  expect(snapshot.dirty).toBe(false)
})

test('choices made on the page are written to the address and restore the same state @playground-tools', async ({
  page,
  openFixture,
}) => {
  await openFixture('everyday')
  await page.locator('#fixture').selectOption('mermaid')
  await page.getByLabel('Configuration').selectOption('minimal')
  await page.getByLabel('Image adapter').selectOption('hold')
  await page.getByLabel('Linked file adapters').check()
  await page.getByLabel('Second read-only editor').check()
  await page.getByRole('button', { name: 'Make read-only' }).click()
  await page.getByLabel('Observe').check()
  await expect
    .poll(() => Object.fromEntries(new URL(page.url()).searchParams))
    .toEqual({
      fixture: 'mermaid',
      configuration: 'minimal',
      adapter: 'hold',
      files: 'true',
      editors: '2',
      editable: 'false',
      observe: 'true',
    })
  const shared = page.url()
  await page.goto('about:blank')
  await page.goto(shared)
  await expect.poll(() => openedDocument(page)).toBe('fixture:mermaid')
  const restored = await observe(page)
  expect(restored.configuration).toBe('minimal')
  expect(restored.adapterMode).toBe('hold')
  expect(restored.editable).toBe(false)
  await expect(page.locator('#second-editor')).toBeVisible()
  await expect(page.getByLabel('Observe')).toBeChecked()
  await expect(page.getByLabel('Linked file adapters')).toBeChecked()
  await page.getByLabel('Image adapter').selectOption('normal')
  await page.getByLabel('Second read-only editor').uncheck()
  await expect
    .poll(() => Object.fromEntries(new URL(page.url()).searchParams))
    .not.toHaveProperty('editors')
})

test('observation is off until Observe is on, and observe() always works @playground-tools', async ({
  page,
  openFixture,
}) => {
  await openFixture()
  const output = page.getByLabel('Structured observations')
  await expect(output).toContainText('Observation is off')
  expect((await observe(page)).snapshot!.text).toContain('# InkKit')
  await page.getByLabel('Observe').check()
  await expect(output).toContainText('"snapshot"')
  await page.getByLabel('Observe').uncheck()
  await expect(output).toContainText('Observation is off')
})

test('typing with observation off shows keystroke timing and the buttons follow the edit @playground-tools', async ({
  page,
  openFixture,
}) => {
  await openFixture()
  await page.getByRole('button', { name: 'Edit source', exact: true }).click()
  await source(page).click()
  await page.keyboard.type('abc')
  await expect(page.getByLabel('Timing')).toContainText(
    'Keystrokes to next frame (last 3)',
  )
  await expect(
    page.getByRole('button', { name: 'Undo', exact: true }),
  ).toBeEnabled()
  const timings = (await observe(page)).timings
  expect(timings.keystrokes?.count).toBe(3)
})

test('the status line leaves an error after the next valid edit @playground-tools', async ({
  page,
  openFixture,
}) => {
  await openFixture('images', '&adapter=reject')
  await operation(page, 'startImagePaste')
  // The paste has reported its error and inserted its placeholder.
  await operation(page, 'finishImagePaste')
  expect((await observe(page)).diagnostics.length).toBeGreaterThan(0)
  // Refreshes the controls now instead of when the refresh timer fires: the
  // paste's own placeholder is not the next edit.
  await operation(page, 'commandState')
  const status = page.locator('#status')
  await expect(status).toHaveText(/unavailable/)
  await page.getByRole('button', { name: 'Edit source', exact: true }).click()
  await source(page).click()
  await page.keyboard.type('x')
  await expect(status).toHaveText(/generation \d+, revision \d+/)
  expect((await observe(page)).diagnostics.length).toBeGreaterThan(0)
  await page.getByRole('button', { name: 'Reset fixture' }).click()
  await expect(status).toHaveText(/fixture:images/)
})

test('a click on a control lands when the controls refresh during it @playground-tools', async ({
  page,
  openFixture,
}) => {
  await openFixture()
  const box = (await page
    .getByRole('button', { name: 'Edit source', exact: true })
    .boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  // An edit's refresh of the controls lands between press and release.
  await operation(page, 'commandState')
  await page.mouse.up()
  await expect(source(page)).toBeVisible()
  expect((await observe(page)).mode).toBe('source')
})

test('a failed operation shows its error and a document load clears it @playground-tools', async ({
  page,
  openFixture,
}) => {
  await openFixture()
  await page.getByRole('button', { name: 'Paste as Plain Text' }).click()
  await expect(page.locator('#status')).toHaveText(/plain text box/)
  await page.getByRole('button', { name: 'Replace document' }).click()
  await expect(page.locator('#status')).toHaveText(/generation \d+/)
})

test('Paste as Plain Text pastes from the visible text box @playground-tools', async ({
  page,
  openFixture,
}) => {
  await openFixture()
  await page.getByLabel('Plain text to paste').fill('Typed **plain** text')
  await page.getByRole('button', { name: 'Paste as Plain Text' }).click()
  await expect
    .poll(async () => (await observe(page)).snapshot?.text)
    .toContain('Typed \\*\\*plain\\*\\* text')
})

for (const id of [
  'table-edge-cases',
  'empty-code-fences',
  'diagram-annotations',
])
  test(`the ${id} fixture opens and saves unchanged @playground-tools`, async ({
    page,
    openFixture,
  }) => {
    await openFixture(id)
    const observed = await observe(page)
    expect(observed.diagnostics).toEqual([])
    expect(observed.snapshot!.text).toBe(fixtures[id]!.text)
    expect(observed.snapshot!.dirty).toBe(false)
  })

test('the diagram annotation fixture renders both diagrams @playground-tools', async ({
  page,
  openFixture,
}) => {
  await openFixture('diagram-annotations')
  const previews = page.locator('.inkkit-mermaid-preview')
  await expect(previews).toHaveCount(2)
  for (const index of [0, 1])
    await expect(previews.nth(index)).toHaveAttribute('data-state', 'ready')
})

test('the table fixture shows an image in a cell @playground-tools', async ({
  page,
  openFixture,
}) => {
  await openFixture('table-edge-cases')
  await expect(page.locator('td img[alt="Fixture"]')).toHaveCount(1)
})
