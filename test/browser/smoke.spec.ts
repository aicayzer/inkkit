import { test, expect, observe, operation, reset } from './fixtures'

test('editing, undo and redo @smoke', async ({ page, openFixture }) => {
  await openFixture()
  const original = (await observe(page)).snapshot!.text
  await page.getByRole('button', { name: 'Edit source', exact: true }).click()
  const source = page.getByRole('textbox', { name: 'Markdown source editor' })
  await source.fill(`${original}\nBrowser edit.`)
  await expect
    .poll(async () => (await observe(page)).snapshot?.text)
    .toContain('Browser edit.')
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect
    .poll(async () => (await observe(page)).snapshot?.text)
    .toBe(original)
  await page.getByRole('button', { name: 'Redo', exact: true }).click()
  await expect
    .poll(async () => (await observe(page)).snapshot?.text)
    .toContain('Browser edit.')
})

test('unsupported authored source survives mode changes @smoke', async ({
  page,
  openFixture,
}) => {
  await openFixture('unsupported')
  const original = (await observe(page)).snapshot
  await page.getByRole('button', { name: 'Edit source', exact: true }).click()
  await page
    .getByRole('button', { name: 'Edit formatted', exact: true })
    .click()
  expect((await observe(page)).snapshot).toEqual(original)
})

test('reset advances generation and disposes held imports @smoke', async ({
  page,
  openFixture,
}) => {
  await openFixture('images', '&adapter=hold')
  const original = (await observe(page)).snapshot!
  await operation(page, 'startImagePaste')
  await expect
    .poll(async () => (await observe(page)).commandState?.pending)
    .toBe(true)
  await reset(page)
  const fresh = await observe(page)
  expect(fresh.snapshot!.generation).toBeGreaterThan(original.generation)
  expect(fresh.snapshot!.text).toBe(original.text)
  expect(fresh.snapshot!.dirty).toBe(false)
  expect(fresh.adapterEvents).toEqual([])
  expect(fresh.diagnostics).toEqual([])
})

test('adapter rejection retains a readable fallback and exposes diagnostics @smoke', async ({
  page,
  openFixture,
}) => {
  await openFixture('images', '&adapter=reject')
  const original = (await observe(page)).snapshot!
  await operation(page, 'startImagePaste')
  await expect
    .poll(async () => (await observe(page)).diagnostics.length)
    .toBeGreaterThan(0)
  const failed = await observe(page)
  expect(failed.snapshot!.text).toContain('![Fixture](images/native.png)')
  expect(failed.snapshot!.text).toContain('fixture.png: image unavailable')
  expect(failed.snapshot!.revision).toBeGreaterThan(original.revision)
  expect(failed.adapterEvents).toContainEqual(
    expect.objectContaining({ operation: 'import', phase: 'rejected' }),
  )
  await page.getByRole('button', { name: 'Reset fixture' }).click()
  await expect.poll(async () => (await observe(page)).diagnostics).toEqual([])
})
