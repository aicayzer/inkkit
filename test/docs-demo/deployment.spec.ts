import { test, expect } from '@playwright/test'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { execFileSync } from 'node:child_process'

const revision = execFileSync('git', ['rev-parse', 'HEAD'], {
  encoding: 'utf8',
}).trim()
for (const kind of ['compact', 'full']) {
  test(`${kind} deployment bundles the current editor and preserves view switching`, async ({
    page,
  }) => {
    const errors: string[] = []
    const network: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))
    page.on('request', (r) => {
      if (/^https?:/.test(r.url())) network.push(r.url())
    })
    await page.setViewportSize({ width: 1280, height: 1000 })
    await page.goto(
      pathToFileURL(resolve(`_local/docs-demo/${kind}.html`)).href,
    )
    await expect(page.locator('meta[name="inkkit-revision"]')).toHaveAttribute(
      'content',
      revision,
    )
    const sourceButton = page.getByRole('button', {
      name: 'Source',
      exact: true,
    })
    await expect(sourceButton).toBeEnabled()
    await sourceButton.click()
    const source = page.getByRole('textbox', { name: 'Markdown source editor' })
    const original = await source.inputValue()
    const edited = 'Café ☕\n\n' + original
    await source.fill(edited)
    await page.getByRole('button', { name: 'Formatted', exact: true }).click()
    await expect(page.locator('#editor pre').first()).toHaveCSS(
      'border-radius',
      '10px',
    )
    await page.locator('#editor pre').first().hover()
    await page
      .getByRole('button', { name: 'Code language', exact: true })
      .first()
      .click()
    await expect(page.getByRole('button', { name: 'Wrap code' })).toBeVisible()
    await page.keyboard.press('Escape')
    await sourceButton.click()
    await expect(source).toHaveValue(edited)
    if (kind === 'compact') {
      await expect(
        page.getByRole('button', { name: 'Reset', exact: true }),
      ).toHaveCount(0)
      await expect(page.getByText('Try editing this note')).toHaveCount(0)
      await expect(
        page.getByRole('link', { name: 'Open playground' }),
      ).toHaveAttribute('href', 'https://inkkit.cyzr.me/editor')
    } else {
      await page.getByRole('button', { name: 'Formatted', exact: true }).click()
      await page.locator('.inkkit-mermaid-preview').scrollIntoViewIfNeeded()
      await expect(page.locator('.inkkit-mermaid-preview')).toHaveAttribute(
        'data-state',
        'ready',
      )
      await expect(page.locator('.top')).toHaveCSS('border-bottom-width', '1px')
      const switchBox = await page
        .getByRole('group', { name: 'View' })
        .boundingBox()
      expect(Math.abs(switchBox!.x + switchBox!.width / 2 - 640)).toBeLessThan(
        1,
      )
      await page.evaluate(() =>
        window.postMessage(
          {
            type: 'inkkit-demo-theme',
            dark: true,
            background: '#0b0b0b',
            navbarInset: 80,
            divider: 'rgba(115, 115, 115, 0.05)',
          },
          '*',
        ),
      )
      await expect(page.locator('.top-in')).toHaveCSS('padding-left', '80px')
      await expect(page.locator('.top')).toHaveCSS('border-top-width', '0px')
      await expect(page.locator('.top')).toHaveCSS(
        'border-bottom-color',
        'rgba(115, 115, 115, 0.05)',
      )
      await expect(page.locator('html')).toHaveCSS('color-scheme', 'dark')
      const tools = await page.locator('.tools').boundingBox()
      const appearance = await page.locator('.appearance').boundingBox()
      expect(tools!.x).toBe(80)
      expect(appearance!.x + appearance!.width).toBe(1200)
      await page.evaluate(() =>
        window.postMessage(
          {
            type: 'inkkit-demo-theme',
            dark: false,
            background: '#fff',
            navbarInset: 16,
          },
          '*',
        ),
      )
      await expect(page.locator('.top-in')).toHaveCSS('padding-left', '16px')
    }
    await page.setViewportSize({ width: 390, height: 844 })
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBe(390)
    expect(network).toEqual([])
    expect(errors).toEqual([])
  })
}
