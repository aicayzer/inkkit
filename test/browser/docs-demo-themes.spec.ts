import { readFile } from 'node:fs/promises'
import { test, expect } from './fixtures'

// Exercise the same srcDoc used by Mintlify, replacing only its CDN URLs so
// the unpublished candidate can be checked through the public editor facade.
async function officialDemo(baseURL: string) {
  const snippet = await readFile('docs/snippets/editor-demo.mdx', 'utf8')
  const component = snippet
    .slice(0, snippet.indexOf('  return (\n    <iframe'))
    .replace('export const', 'const')
  const render = new Function(
    'useRef',
    'useEffect',
    `${component}\nreturn html\n}\nreturn EditorDemo`,
  )
  const html: string = render(
    () => ({ current: null }),
    () => {},
  )({ fullPage: true })
  const sheets = await Promise.all(
    [
      'style.css',
      'themes/standard.css',
      'themes/calm.css',
      'themes/essential.css',
    ].map((file) => readFile(`src/${file}`, 'utf8')),
  )
  return html
    .replaceAll(
      /<link rel="stylesheet" href="https:\/\/cdn\.jsdelivr\.net[^"]+">/g,
      '',
    )
    .replace('</head>', `<style>${sheets.join('\n')}</style></head>`)
    .replaceAll(
      /https:\/\/cdn\.jsdelivr\.net\/npm\/@aicayzer\/inkkit@[^/]+\/dist\/(index|core)\.js/g,
      `${baseURL}/@fs${process.cwd()}/src/core.ts`,
    )
    .replace(
      'let editor;',
      'let editor; window.demoSnapshot = () => editor.snapshot(generation);',
    )
}

test('official playground switches real presets without changing the document @playground-tools', async ({
  page,
  baseURL,
}, testInfo) => {
  // The fixture registers the candidate renderer before this demo imports the
  // shared core facade, including when the browser fixture is built.
  await page.goto('/')
  await expect
    .poll(() =>
      page.evaluate(
        () => window.inkkitPlayground?.observe().snapshot?.documentId,
      ),
    )
    .toBe('fixture:everyday')
  await page.setContent(await officialDemo(baseURL!))
  const snapshot = () =>
    page.evaluate(() =>
      (window as unknown as { demoSnapshot: () => unknown }).demoSnapshot(),
    )
  await expect
    .poll(() => page.locator('#status').textContent())
    .not.toBe('Loading editor…')
  const toolbar = page.getByRole('toolbar', { name: 'Editor controls' })
  await expect(toolbar).toHaveText('')
  await expect(toolbar.getByRole('button')).toHaveCount(8)
  for (const label of [
    'Formatted',
    'Source',
    'Find',
    'Undo',
    'Redo',
    'Copy Markdown',
    'Reset',
    'Focus',
  ]) {
    await expect(
      toolbar.getByRole('button', { name: label, exact: true }),
    ).toHaveAttribute('title', label)
  }
  await expect(page.locator('.hint')).toHaveCount(0)
  await expect(page.locator('#status')).not.toHaveClass(/status-error/)
  await expect(
    page.getByRole('combobox', { name: 'Theme', exact: true }),
  ).toHaveValue('standard')
  await page.locator('#editor .inkkit-mermaid-preview').scrollIntoViewIfNeeded()
  await expect(page.locator('#editor .inkkit-mermaid-preview')).toHaveAttribute(
    'data-state',
    'ready',
  )
  await page.getByRole('button', { name: 'Source', exact: true }).click()
  const source = page.getByRole('textbox', { name: 'Markdown source editor' })
  await source.fill(`A theme edit.\n\n${await source.inputValue()}`)
  const before = await snapshot()
  for (const theme of ['standard', 'calm', 'essential']) {
    await page
      .getByRole('combobox', { name: 'Theme', exact: true })
      .selectOption(theme)
    for (const scheme of ['light', 'dark']) {
      await page
        .getByRole('combobox', { name: 'Appearance', exact: true })
        .selectOption(scheme)
      expect(await snapshot()).toEqual(before)
      await expect(page.locator('#editor')).toHaveAttribute(
        'data-inkkit-theme',
        theme,
      )
      expect(
        await page
          .locator('#editor')
          .evaluate((root) => getComputedStyle(root).colorScheme),
      ).toBe(scheme)
      await page.getByRole('button', { name: 'Formatted', exact: true }).click()
      const expected = theme === 'essential' ? '4px' : '8px'
      expect(
        await page
          .locator('#editor table')
          .evaluate((table) => getComputedStyle(table).borderTopLeftRadius),
      ).toBe(expected)
      expect(
        await page
          .locator('#editor pre[data-language=ts]')
          .evaluate((code) => getComputedStyle(code).borderTopLeftRadius),
      ).toBe(expected)
      await page
        .locator('#editor .inkkit-mermaid-preview')
        .scrollIntoViewIfNeeded()
      await expect(
        page.locator('#editor .inkkit-mermaid-preview'),
      ).toHaveAttribute('data-state', 'ready')
      await page.screenshot({
        path: testInfo.outputPath(`official-${theme}-${scheme}.png`),
        fullPage: true,
      })
      await page.getByRole('button', { name: 'Source', exact: true }).click()
    }
  }
  await page.evaluate(() =>
    window.postMessage({ type: 'inkkit-demo-theme', dark: false }, '*'),
  )
  expect(
    await page
      .locator('#editor')
      .evaluate((root) => getComputedStyle(root).colorScheme),
  ).toBe('dark')
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect(source).not.toHaveValue(/A theme edit\./)
  await page.getByRole('button', { name: 'Redo', exact: true }).click()
  await expect(source).toHaveValue(/A theme edit\./)
  await page.getByRole('button', { name: 'Formatted', exact: true }).click()
  for (const width of [320, 390, 1280]) {
    await page.setViewportSize({ width, height: 800 })
    expect((await toolbar.boundingBox())?.x).toBe(width <= 520 ? 16 : 24)
    await expect(
      page.getByRole('combobox', { name: 'Theme', exact: true }),
    ).toBeVisible()
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true)
    for (const scheme of ['light', 'dark']) {
      await page
        .getByRole('combobox', { name: 'Appearance', exact: true })
        .selectOption(scheme)
      await page.screenshot({
        path: testInfo.outputPath(`official-${width}-${scheme}.png`),
      })
    }
  }
  await page.getByRole('button', { name: 'Find', exact: true }).click()
  const query = page.getByRole('searchbox', { name: 'Find', exact: true })
  await query.fill('a phrase absent from the demo')
  await query.press('Enter')
  await expect(page.locator('#status')).toHaveClass(/status-error/)
  await expect(page.locator('#status')).toBeVisible()
  await expect(page.locator('#status')).toContainText('No matches')
  await page.getByRole('button', { name: 'Close find', exact: true }).click()
  await expect(
    page.getByRole('button', { name: 'Find', exact: true }),
  ).toBeFocused()
  await page.screenshot({ path: testInfo.outputPath('official-focus.png') })
  await page.getByRole('button', { name: 'Reset', exact: true }).hover()
  await page.screenshot({ path: testInfo.outputPath('official-hover.png') })
})
