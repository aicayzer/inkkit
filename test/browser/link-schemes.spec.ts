import { expect, test } from '@playwright/test'

const moduleUrl = `/@fs${process.cwd()}/src/core.ts`

// A host that lists a scheme gets Mod-click on that link, and only for that editor.
test('linkSchemes opens a listed scheme on a Mod-click, not an unlisted one, and keeps each editor apart', async ({
  page,
}) => {
  await page.goto('/')
  await page.waitForFunction(() => Boolean(window.inkkitPlayground))
  await page.evaluate(async (moduleUrl) => {
    const { InkKitEditor } = (await import(
      moduleUrl
    )) as typeof import('../../src/core')
    const opened: Record<string, string[]> = { a: [], b: [] }
    const mount = async (id: string, linkSchemes?: string[]) => {
      const root = document.createElement('div')
      root.id = id
      root.style.cssText = 'width:480px;padding:8px'
      document.body.prepend(root)
      const editor = await InkKitEditor.mount(
        root,
        { changed() {}, openLink: (href) => opened[id]!.push(href) },
        { linkSchemes },
      )
      editor.loadDocument({
        documentId: id,
        generation: 1,
        format: 'md',
        text: `[Things ${id}](things:///add?title=x)\n\n[Mail ${id}](message:%3Cx@h%3E)\n\n[Script ${id}](javascript:alert(1))\n`,
      })
      return editor
    }
    ;(window as unknown as Record<string, unknown>).schemeTest = {
      opened,
      a: await mount('a', ['Things']),
      b: await mount('b', ['message']),
    }
  }, moduleUrl)

  const modifier = 'ControlOrMeta'
  for (const id of ['a', 'b'])
    for (const name of ['Things', 'Mail', 'Script'])
      await page
        .locator(`#${id}`)
        .getByRole('link', { name: `${name} ${id}` })
        .click({ modifiers: [modifier] })
  const opened = await page.evaluate(
    () =>
      (window as unknown as { schemeTest: { opened: unknown } }).schemeTest
        .opened,
  )
  expect(opened).toEqual({
    a: ['things:///add?title=x'],
    b: ['message:%3Cx@h%3E'],
  })
  // An unmodified click opens nothing and leaves the page where it is.
  await page.locator('#a').getByRole('link', { name: 'Things a' }).click()
  expect(page.url()).not.toContain('things:')
})
