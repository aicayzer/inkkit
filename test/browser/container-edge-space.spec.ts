import { test, expect, observe, operation } from './fixtures'

const containers = [
  ['callout', '> [!NOTE]\n> alpha beta\n'],
  ['compact callout', '>[!NOTE]\n>alpha beta\n'],
  ['quote', '> alpha beta\n'],
  ['indented callout', '> [!NOTE]\n>  alpha beta\n'],
  ['indented quote', '>    alpha beta\n'],
  ['bullet continuation', '+ first\n  alpha beta\n'],
  ['ordered continuation', '1. first\n   alpha beta\n'],
  ['task continuation', '- [x] first\n  alpha beta\n'],
  ['list', '+   alpha beta\n'],
] as const

for (const [container, body] of containers)
  for (const action of [
    'Delete',
    'Backspace',
    'word Backspace',
    'trailing Delete',
    'trailing Space',
  ] as const)
    test(`${action} preserves edge spaces in a ${container} @preservation`, async ({
      page,
      openFixture,
    }) => {
      await openFixture()
      const source = `__Before__ &amp;\n\n${body}\nAfter&#33;\n`
      await operation(page, 'reload', { text: source })
      expect((await observe(page)).snapshot!.text).toBe(source)
      const snapshot = (await operation(page, 'textSnapshot')) as {
        snapshotId: string
        text: string
      }
      const trailing = action.startsWith('trailing')
      const from = snapshot.text.indexOf(trailing ? 'beta' : 'alpha')
      const start =
        action === 'word Backspace'
          ? from + 5
          : action === 'trailing Space'
            ? from + 4
            : from
      await operation(page, 'selectTextRange', {
        range: {
          snapshotId: snapshot.snapshotId,
          from: start,
          to:
            action === 'word Backspace' || action === 'trailing Space'
              ? start
              : from + (trailing ? 4 : 5),
        },
        options: { focus: true },
      })
      if (action === 'word Backspace')
        await page.keyboard.press(
          process.platform === 'darwin' ? 'Alt+Backspace' : 'Control+Backspace',
        )
      else
        await page.keyboard.press(
          action === 'trailing Space'
            ? 'Space'
            : action === 'trailing Delete'
              ? 'Delete'
              : action,
        )
      const saved = source.replace(
        'alpha beta',
        action === 'trailing Space'
          ? 'alpha beta&#x20;'
          : trailing
            ? 'alpha&#x20;'
            : '&#x20;beta',
      )
      const observed = await observe(page)
      expect(observed.diagnostics).toEqual([])
      expect(observed.snapshot!.text).toBe(saved)
      const surface = page.getByRole('textbox', {
        name: 'Formatted Markdown editor',
        exact: true,
      })
      const html = await surface.innerHTML()
      const readable = observed.textSnapshot!.text
      await operation(page, 'reload', { text: saved })
      expect((await observe(page)).snapshot!.text).toBe(saved)
      expect((await observe(page)).textSnapshot!.text).toBe(readable)
      expect(await surface.innerHTML()).toBe(html)
    })
