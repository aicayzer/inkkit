import { test, expect, observe, operation, caretAfterMatch } from './fixtures'

// Predictive text ends a typed sentence with a space. The editor keeps it, and
// the saved Markdown leaves it out instead of writing `&#x20;`.
for (const ending of ['\n', '\r\n'])
  test(`a sentence typed with a final space saves without it (${JSON.stringify(ending)}) @preservation`, async ({
    page,
    openFixture,
  }) => {
    await openFixture()
    const lines = (text: string) => text.replaceAll('\n', ending)
    const source = lines('# Shopping list\n\nMilk\n\n- item&#x20;\n')
    await operation(page, 'reload', { text: source })
    await caretAfterMatch(page, 'Milk')
    await page.keyboard.type(' and bread. ')
    let observed = await observe(page)
    expect(observed.diagnostics).toEqual([])
    const saved = lines('# Shopping list\n\nMilk and bread.\n\n- item&#x20;\n')
    expect(observed.snapshot).toMatchObject({ text: saved, dirty: true })
    expect(observed.textSnapshot!.text).toContain('Milk and bread. \n')
    // The caret stays after the space, so the next word follows it.
    await page.keyboard.type('Eggs. ')
    observed = await observe(page)
    expect(observed.diagnostics).toEqual([])
    const more = lines(
      '# Shopping list\n\nMilk and bread. Eggs.\n\n- item&#x20;\n',
    )
    expect(observed.snapshot!.text).toBe(more)
    await operation(page, 'reload', { text: more })
    observed = await observe(page)
    expect(observed.snapshot).toMatchObject({ text: more, dirty: false })
    expect(observed.textSnapshot!.text).toContain('Milk and bread. Eggs.\n')
  })
