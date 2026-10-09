import { test, expect, observe, operation } from './fixtures'
import { linkedSource } from '../../scripts/interop/consumer/fixtures'

test('optional wiki/files preserve source, resolve offline kinds and route host actions @linked-files', async ({
  page,
  openFixture,
}) => {
  await openFixture('linked-files')
  await expect(page.locator('[data-inkkit-file-kind="image"] img')).toHaveCount(
    3,
  )
  await expect(page.locator('audio')).toHaveCount(1)
  await expect(page.locator('video')).toHaveCount(1)
  await expect(page.locator('iframe[sandbox=""]')).toHaveCount(1)
  await expect(
    page.getByRole('status').filter({ hasText: 'Open to view this PDF' }),
  ).toBeVisible()
  await expect(
    page.locator(
      '[data-inkkit-file-kind="file"][data-inkkit-file-state="resolved"]',
    ),
  ).toHaveCount(1)
  expect((await observe(page)).snapshot!.text).toBe(linkedSource)
  const wiki = page.getByRole('link', { name: 'Travel plan', exact: true })
  await wiki.click({ modifiers: ['Meta'] })
  await wiki.focus()
  await page.keyboard.press('Enter')
  const photo = page
    .locator('.inkkit-file')
    .filter({ has: page.locator('img[alt="Photo"]') })
    .last()
  await photo.getByRole('button', { name: 'Open Photo', exact: true }).click()
  await photo.dispatchEvent('contextmenu', { clientX: 12, clientY: 20 })
  const events = (await operation(page, 'fileEvents')) as {
    operation: string
    reference?: string
    fragment?: string
  }[]
  expect(events.filter((e) => e.operation === 'wikiOpen')).toHaveLength(2)
  expect(events).toContainEqual(
    expect.objectContaining({
      operation: 'wikiOpen',
      reference: 'Notes/旅行',
      fragment: 'Résumé',
    }),
  )
  expect(events).toContainEqual(
    expect.objectContaining({ operation: 'open', reference: 'Photo' }),
  )
  expect(events).toContainEqual(
    expect.objectContaining({ operation: 'contextMenu', reference: 'Photo' }),
  )
  expect(
    await page.evaluate(() =>
      performance
        .getEntriesByType('resource')
        .filter(
          (e) => /^https?:/.test(e.name) && !e.name.startsWith(location.origin),
        ),
    ),
  ).toEqual([])
  await page.evaluate(() =>
    window.inkkitPlayground.reset('linked-files', 'minimal'),
  )
  expect((await observe(page)).snapshot!.text).toBe(linkedSource)
  await expect(
    page.locator('.inkkit-file, .inkkit-wiki-link, audio, video, iframe'),
  ).toHaveCount(0)
})

test('media controls survive read-only and release resources when hidden @linked-files', async ({
  page,
  openFixture,
}) => {
  await openFixture('linked-files')
  await expect(page.locator('audio')).toHaveCount(1)
  await expect
    .poll(() =>
      page.locator('audio').evaluate((e) => (e as HTMLAudioElement).readyState),
    )
    .toBeGreaterThanOrEqual(1)
  await expect
    .poll(() =>
      page.locator('video').evaluate((e) => (e as HTMLVideoElement).readyState),
    )
    .toBeGreaterThanOrEqual(1)
  await page.locator('audio').evaluate(async (e) => {
    const a = e as HTMLAudioElement
    a.loop = true
    await a.play()
  })
  const src = await page.locator('audio').getAttribute('src')
  await operation(page, 'editable', { editable: false })
  expect(await page.locator('audio').getAttribute('src')).toBe(src)
  expect(
    await page.locator('audio').evaluate((e) => (e as HTMLAudioElement).paused),
  ).toBe(false)
  await operation(page, 'editingMode', { mode: 'source' })
  await expect(page.locator('audio[src], video[src], iframe[src]')).toHaveCount(
    0,
  )
  await operation(page, 'editingMode', { mode: 'formatted' })
  await expect(page.locator('audio[src]')).toHaveCount(1)
  expect(
    await page.locator('audio').evaluate((e) => (e as HTMLAudioElement).paused),
  ).toBe(true)
  await page.evaluate(() =>
    window.inkkitPlayground.replaceDocument(
      '> [!NOTE]+ Media\n> ![[Voice#t=0,0.5]]\n',
      'md',
    ),
  )
  await expect(page.locator('audio[src]')).toHaveCount(1)
  await page.locator('audio').evaluate(async (e) => {
    const a = e as HTMLAudioElement
    a.loop = true
    await a.play()
  })
  await page
    .getByRole('button', { name: 'Collapse Media', exact: true })
    .click()
  await expect(page.locator('audio[src]')).toHaveCount(0)
  await page.getByRole('button', { name: 'Expand Media', exact: true }).click()
  await expect(page.locator('audio[src]')).toHaveCount(1)
  expect(
    await page.locator('audio').evaluate((e) => (e as HTMLAudioElement).paused),
  ).toBe(true)
})

test('retry, cancelled and stale resolutions retain editable authored content @linked-files', async ({
  page,
  openFixture,
}) => {
  await openFixture('linked-files')
  await operation(page, 'fileMode', { mode: 'reject' })
  await page.evaluate(() =>
    window.inkkitPlayground.replaceDocument('![[Photo|140]]\n', 'md'),
  )
  await expect(page.locator('[data-inkkit-file-state="failed"]')).toHaveCount(1)
  await operation(page, 'fileMode', { mode: 'normal' })
  await page.getByRole('button', { name: 'Retry', exact: true }).click()
  await expect(page.locator('.inkkit-file img')).toHaveCount(1)
  await operation(page, 'fileMode', { mode: 'hold' })
  await operation(page, 'reload', {
    sameGeneration: true,
    text: '![[Late|120]]\n',
  })
  await expect(page.locator('[data-inkkit-file-state="loading"]')).toHaveCount(
    1,
  )
  await page.evaluate(() =>
    window.inkkitPlayground.replaceDocument('Replacement 😀\n', 'md'),
  )
  await operation(page, 'fileRelease')
  await expect(page.locator('.inkkit-file')).toHaveCount(0)
  expect((await observe(page)).snapshot!.text).toBe('Replacement 😀\n')
  const events = (await operation(page, 'fileEvents')) as {
    phase: string
    reference?: string
  }[]
  expect(events).toContainEqual(
    expect.objectContaining({ phase: 'aborted', reference: 'Late' }),
  )
  await operation(page, 'fileMode', { mode: 'corrupt' })
  await page.evaluate(() =>
    window.inkkitPlayground.replaceDocument('![[Movie]]\n', 'md'),
  )
  await expect(page.locator('[data-inkkit-file-state="failed"]')).toHaveCount(1)
  expect((await observe(page)).snapshot!.text).toBe('![[Movie]]\n')
})

test('named and path sizing isolate undo and reject read-only/composition mutation @linked-files', async ({
  page,
  openFixture,
}) => {
  await openFixture('linked-files')
  await page.evaluate(() =>
    window.inkkitPlayground.replaceDocument(
      'Before\n\n![[Photo|140]]\n\n![Path|120](images/native.png)\n',
      'md',
    ),
  )
  await expect(page.locator('.inkkit-file img')).toHaveCount(2)
  await operation(page, 'find', { text: 'Before' })
  await operation(page, 'insertText', { text: 'Adjacent' })
  const resize = async (index: number, delta: number) => {
    const handle = page.locator('.image-handle').nth(index)
    await handle.hover()
    const box = await handle.boundingBox()
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2)
    await page.mouse.down()
    await page.mouse.move(
      box!.x + box!.width / 2 + delta,
      box!.y + box!.height / 2,
      { steps: 3 },
    )
    await page.mouse.up()
  }
  await resize(0, 40)
  expect((await observe(page)).snapshot!.text).toContain('![[Photo|180]]')
  await operation(page, 'undo')
  expect((await observe(page)).snapshot!.text).toBe(
    'Adjacent\n\n![[Photo|140]]\n\n![Path|120](images/native.png)\n',
  )
  await operation(page, 'redo')
  await resize(1, 30)
  expect((await observe(page)).snapshot!.text).toContain(
    '![Path|150](images/native.png)',
  )
  await operation(page, 'undo')
  expect((await observe(page)).snapshot!.text).toContain(
    '![Path|120](images/native.png)',
  )
  const before = (await observe(page)).snapshot!.text
  await operation(page, 'editable', { editable: false })
  await resize(0, 30)
  expect((await observe(page)).snapshot!.text).toBe(before)
  await operation(page, 'editable', { editable: true })
  await page
    .getByRole('textbox', { name: 'Formatted Markdown editor', exact: true })
    .dispatchEvent('compositionstart', { data: '中' })
  await resize(0, 30)
  await page
    .getByRole('textbox', { name: 'Formatted Markdown editor', exact: true })
    .dispatchEvent('compositionend', { data: '' })
  expect((await observe(page)).snapshot!.text).toBe(before)
  await operation(page, 'reload')
  expect((await observe(page)).snapshot!.text).toBe(before)
})

test('every kind has safe copy/print output and stale exports cancel promptly @linked-files', async ({
  page,
  openFixture,
}) => {
  await openFixture('linked-files')
  const output = (await operation(page, 'clipboard')) as {
    text: string
    html: string
    markdown: string
    images: { image?: unknown }[]
  }
  expect(output.markdown).toBe(linkedSource)
  for (const label of [
    'Travel plan',
    'Audio:',
    'Video:',
    'PDF:',
    'File: Archive',
    'Missing',
    'Broken',
  ])
    expect(output.text).toContain(label)
  expect(output.images.filter((i) => i.image)).toHaveLength(3)
  expect(output.html).not.toMatch(
    /blob:|<audio|<video|<iframe|<object|onclick|data-inkkit-wiki/,
  )
  const print = (await operation(page, 'printable')) as {
    html: string
    warnings: { code: string }[]
    assets: unknown[]
  }
  expect(print.assets).toHaveLength(3)
  expect(
    print.warnings.filter((w) => w.code === 'attachment-fallback'),
  ).toHaveLength(4)
  expect(
    print.warnings.filter((w) => w.code === 'attachment-unavailable'),
  ).toHaveLength(2)
  expect(print.html).not.toMatch(/blob:|<audio|<video|<iframe|<object/)
  await operation(page, 'fileMode', { mode: 'hold' })
  await operation(page, 'startOutput', { kind: 'copy' })
  await operation(page, 'reload', { sameGeneration: true })
  await expect(operation(page, 'finishOutput')).rejects.toThrow(
    /changed|stale/i,
  )
  await operation(page, 'fileRelease')
  await operation(page, 'fileMode', { mode: 'hold' })
  await operation(page, 'startOutput', { kind: 'print' })
  await operation(page, 'editingMode', { mode: 'source' })
  await expect(operation(page, 'finishOutput')).rejects.toThrow(
    /changed|stale/i,
  )
  await operation(page, 'fileRelease')
})
