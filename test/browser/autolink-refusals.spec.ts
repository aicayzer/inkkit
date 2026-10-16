import { test, expect, observe, operation } from './fixtures'
import { autolinkRefusalCases } from '../autolink-refusals-cases'

for (const [wrapper, saved] of autolinkRefusalCases)
  test(`plain-text paste keeps ${wrapper} around a URL literal @preservation`, async ({
    page,
    openFixture,
  }) => {
    await openFixture()
    const source = 'Start\r\n\r\n+   untouched é &copy;\r\n'
    await operation(page, 'reload', { text: source })
    const readable = (await operation(page, 'textSnapshot')) as {
      snapshotId: string
      text: string
    }
    await operation(page, 'selectTextRange', {
      range: { snapshotId: readable.snapshotId, from: 5, to: 5 },
      options: { focus: true },
    })
    expect(
      await operation(page, 'pastePlain', {
        text: ` ${wrapper}http://x.com${wrapper}`,
      }),
    ).toBe(true)
    const expected = `Start ${saved}\r\n\r\n+   untouched é &copy;\r\n`
    expect((await observe(page)).diagnostics).toEqual([])
    expect((await observe(page)).snapshot!.text).toBe(expected)
    const content = (await operation(page, 'clipboard', {
      scope: 'document',
    })) as { text: string; html: string }
    expect(content.text).toContain(`Start ${wrapper}http://x.com${wrapper}`)
    await operation(page, 'undo')
    expect((await observe(page)).snapshot!.text).toBe(source)
    await operation(page, 'redo')
    expect((await observe(page)).snapshot!.text).toBe(expected)
    await operation(page, 'reload', { text: expected })
    const reopened = (await operation(page, 'clipboard', {
      scope: 'document',
    })) as { text: string; html: string }
    expect(reopened.text).toBe(content.text)
    expect(reopened.html.replace(/ data-inkkit-link-form="[^"]*"/g, '')).toBe(
      content.html.replace(/ data-inkkit-link-form="[^"]*"/g, ''),
    )
  })

test('typing a pipe inside a bare URL in a table cell is accepted @preservation', async ({
  page,
  openFixture,
}) => {
  await openFixture()
  const source =
    '| Link |\r\n| --- |\r\n| http://x.com/path |\r\n\r\n+   untouched é &copy;\r\n'
  await operation(page, 'reload', { text: source })
  const readable = (await operation(page, 'textSnapshot')) as {
    snapshotId: string
    text: string
  }
  const at = readable.text.indexOf('.com') + 4
  await operation(page, 'selectTextRange', {
    range: { snapshotId: readable.snapshotId, from: at, to: at },
    options: { focus: true },
  })
  await page.keyboard.type('|')
  expect((await observe(page)).diagnostics).toEqual([])
  const expected = source.replace(
    'http://x.com/path',
    '[http://x.com\\|/path](http://x.com\\|/path)',
  )
  expect((await observe(page)).snapshot!.text).toBe(expected)
  const content = (await operation(page, 'clipboard', {
    scope: 'document',
  })) as { text: string; html: string }
  await operation(page, 'reload', { text: expected })
  const reopened = (await operation(page, 'clipboard', {
    scope: 'document',
  })) as { text: string; html: string }
  expect(reopened.text).toBe(content.text)
  expect(reopened.html.replace(/ data-inkkit-link-form="[^"]*"/g, '')).toBe(
    content.html.replace(/ data-inkkit-link-form="[^"]*"/g, ''),
  )
})

for (const [wrapper] of autolinkRefusalCases)
  test(`typing ${wrapper} around an address stays saveable @preservation`, async ({
    page,
    openFixture,
  }) => {
    await openFixture()
    await operation(page, 'reload', { text: 'Start\n' })
    const readable = (await operation(page, 'textSnapshot')) as {
      snapshotId: string
      text: string
    }
    await operation(page, 'selectTextRange', {
      range: { snapshotId: readable.snapshotId, from: 5, to: 5 },
      options: { focus: true },
    })
    await page.keyboard.type(` ${wrapper}http://x.com${wrapper}`)
    const before = await observe(page)
    expect(before.diagnostics).toEqual([])
    const saved = before.snapshot!.text
    const content = (await operation(page, 'clipboard', {
      scope: 'document',
    })) as { text: string; html: string }
    // Typing invokes Markdown input rules; literal paste deliberately does not.
    if (wrapper !== '`') {
      const mark = wrapper === '__' ? '**' : wrapper
      expect(saved).toBe(`Start ${mark}http://x.com${mark}\n`)
    }
    await operation(page, 'reload', { text: saved })
    expect((await observe(page)).snapshot!.text).toBe(saved)
    const reopened = (await operation(page, 'clipboard', {
      scope: 'document',
    })) as { text: string; html: string }
    expect(reopened.text).toBe(content.text)
    expect(reopened.html.replace(/ data-inkkit-link-form="[^"]*"/g, '')).toBe(
      content.html.replace(/ data-inkkit-link-form="[^"]*"/g, ''),
    )
  })
