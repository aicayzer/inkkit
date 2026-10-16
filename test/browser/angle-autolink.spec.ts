import { test, expect, observe, operation } from './fixtures'
import { angleAutolinkCases } from '../angle-autolink-cases'

for (const [name, source, typed, expected] of angleAutolinkCases)
  test(`typing angle brackets around ${name} preserves the authored source @preservation`, async ({
    page,
    openFixture,
  }, testInfo) => {
    await openFixture()
    await operation(page, 'reload', { text: source })
    expect((await observe(page)).snapshot!.text).toBe(source)
    await operation(page, 'textSnapshot')
    const readable = (await observe(page)).lastResult as {
      snapshotId: string
      text: string
    }
    const from = readable.text.indexOf('x')
    await operation(page, 'selectTextRange', {
      range: { snapshotId: readable.snapshotId, from, to: from + 1 },
      options: { focus: true },
    })
    await page.keyboard.type(typed)
    const before = await observe(page)
    const content = (await operation(page, 'clipboard', {
      scope: 'document',
    })) as { text: string; html: string }
    const saved = before.snapshot!.text
    await operation(page, 'reload', { text: saved })
    const reopened = (await operation(page, 'clipboard', {
      scope: 'document',
    })) as { text: string; html: string }
    const semanticHTML = (html: string) =>
      html.replace(/ data-inkkit-link-form="[^"]*"/g, '')
    const same =
      reopened.text === content.text &&
      semanticHTML(reopened.html) === semanticHTML(content.html)
    const result = { name, saved, same, diagnostics: before.diagnostics }
    console.log(JSON.stringify(result))
    await testInfo.attach('saved-bytes', {
      body: JSON.stringify(result, null, 2),
      contentType: 'application/json',
    })
    expect(before.diagnostics).toEqual([])
    expect(same).toBe(true)
    expect((await observe(page)).snapshot!.text).toBe(saved)
    expect(saved).toBe(expected)
  })
