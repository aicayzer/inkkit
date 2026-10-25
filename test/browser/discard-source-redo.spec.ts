import { test, expect, observe, operation } from './fixtures'

for (const original of ['', 'Prior']) {
  test(`source branching discards formatted redo while preserving undo: ${original || 'empty'}`, async ({
    page,
    openFixture,
  }) => {
    await openFixture()
    await page.evaluate(
      (text) => window.inkkitPlayground.replaceDocument(text, 'md'),
      original,
    )
    await page.clock.setFixedTime(new Date(2026, 0, 1))
    if (original)
      expect(await operation(page, 'insertText', { text: 'X' })).toBe(true)
    await operation(page, 'focus')
    if (original)
      for (let i = 0; i < 6; i++) await page.keyboard.press('ArrowLeft')
    await page.keyboard.type('E')
    await operation(page, 'editingMode', { mode: 'source' })
    expect(await operation(page, 'undo')).toBe(true)
    const before = (await observe(page)).snapshot!.text
    const area = page.locator('textarea.inkkit-plain')
    await area.focus()
    await page.keyboard.type('n')
    expect(await area.inputValue()).toContain('n')
    expect(await operation(page, 'undo')).toBe(true)
    expect((await observe(page)).snapshot!.text).toBe(before)
    await operation(page, 'editingMode', { mode: 'formatted' })
    const state = (await observe(page)).commandState!.commands
    const redo = await operation(page, 'redo')
    const after = (await observe(page)).snapshot!.text
    expect(state.redo).toBe(false)
    expect(redo).toBe(false)
    expect(after).toBe(before)
    if (original) {
      expect((await observe(page)).commandState!.commands.undo).toBe(true)
      expect(await operation(page, 'undo')).toBe(true)
      expect((await observe(page)).snapshot!.text).toBe(original)
      expect((await observe(page)).commandState!.commands.redo).toBe(true)
      expect(await operation(page, 'redo')).toBe(true)
      expect((await observe(page)).snapshot!.text).toBe(before)
      expect((await observe(page)).commandState!.commands.redo).toBe(false)
      expect(await operation(page, 'redo')).toBe(false)
    }
    const saved = (await observe(page)).snapshot!.text
    await page.evaluate(
      (text) => window.inkkitPlayground.replaceDocument(text, 'md'),
      saved,
    )
    expect((await observe(page)).snapshot!.text).toBe(before)
  })
}
