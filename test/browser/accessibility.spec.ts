import { createRequire } from 'node:module'
import type { Page } from '@playwright/test'
import { test, expect, operation } from './fixtures'

const axePath = createRequire(import.meta.url).resolve('axe-core')

const source =
  '# Roles\n\nText with a note.[^1] <!--inline comment-->\n\n' +
  '<!--block comment-->\n\n<section>raw block</section>\n\n' +
  '![[Photo|140]]\n\n![[Missing]]\n\n![[Voice#t=0,0.5]]\n\n[^1]: The note.\n'

async function open(
  page: Page,
  openFixture: (fixture?: string) => Promise<void>,
) {
  await openFixture('linked-files')
  await page.evaluate(
    (text) => window.inkkitPlayground.replaceDocument(text, 'md'),
    source,
  )
  await operation(page, 'commentsVisible', { visible: true })
  await expect(
    page.locator('.inkkit-file[data-inkkit-file-state="resolved"]').first(),
  ).toBeVisible()
  await expect(page.locator('.inkkit-comment').first()).toBeVisible()
}

const editor = (page: Page) =>
  page.getByRole('textbox', { name: 'Formatted Markdown editor' })

test('cards, notes and preserved blocks have accessible roles and no axe findings @linked-files', async ({
  page,
  openFixture,
}) => {
  await open(page, openFixture)
  await test.step('roles and names in the accessibility tree', async () => {
    await expect(editor(page)).toMatchAriaSnapshot(`
      - textbox "Formatted Markdown editor":
        - heading "Roles" [level=1]
        - paragraph:
          - text: Text with a note.
          - button "Footnote 1"
          - note "Author comment": inline comment
        - note "Author comment": block comment
        - group "Preserved Markdown"
        - group "Photo":
          - img "Photo"
          - button "Open Photo"
        - group "Missing":
          - button "Open Missing"
          - status: File unavailable
          - button "Retry"
        - group "Voice#t=0,0.5":
          - button "Open Voice#t=0,0.5"
        - note "Footnote 1":
          - paragraph: The note.`)
  })
  await test.step('axe violations and incomplete findings', async () => {
    await page.addScriptTag({ path: axePath })
    const findings = await page.evaluate(async () => {
      const { axe } = window as unknown as { axe: typeof import('axe-core') }
      const result = await axe.run('.inkkit-root .ProseMirror.editor', {
        // Color contrast depends on the host page; names and roles are Inkkit's.
        rules: { 'color-contrast': { enabled: false } },
      })
      // "Incomplete" means axe wants a person to check, so it counts as a finding.
      return [...result.violations, ...result.incomplete].map((finding) => ({
        id: finding.id,
        nodes: finding.nodes.map((node) => node.html.slice(0, 120)),
      }))
    })
    expect(findings).toEqual([])
  })
})
