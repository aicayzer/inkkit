import { expect, test, vi } from 'vitest'
import { DecorationSet } from '@milkdown/kit/prose/view'
import { withFacade } from './editor-access'

test('task decoration lookup stays bounded after an item split and typing', async () => {
  const source =
    Array.from(
      { length: 1024 },
      (_, index) => `+ [ ] Task ${index} café 😀`,
    ).join('\r\n') + '\r\n'
  await withFacade(source, (editor) => {
    const snapshot = editor.textSnapshot()!
    const needle = 'Task 500 café 😀'
    const from = snapshot.text.indexOf(needle) + needle.length
    editor.selectTextRange({ snapshotId: snapshot.snapshotId, from, to: from })
    const original = DecorationSet.prototype.forChild
    let largest = 0,
      lookups = 0
    const spy = vi
      .spyOn(DecorationSet.prototype, 'forChild')
      .mockImplementation(function (this: DecorationSet, offset, child) {
        // Count reads of the sorted child offsets while the real view renders
        // facade edits. Restore the dependency's data after every lookup.
        const descriptor = Object.getOwnPropertyDescriptor(this, 'children')!
        const children = descriptor.value as unknown[]
        let reads = 0
        Object.defineProperty(this, 'children', {
          ...descriptor,
          value: new Proxy(children, {
            get(target, key, receiver) {
              if (
                typeof key === 'string' &&
                /^\d+$/.test(key) &&
                Number(key) % 3 === 0
              )
                reads++
              return Reflect.get(target, key, receiver)
            },
          }),
        })
        try {
          return original.call(this, offset, child)
        } finally {
          Object.defineProperty(this, 'children', descriptor)
          if (children.length >= 512 * 3) {
            lookups++
            largest = Math.max(largest, reads)
          }
        }
      })
    try {
      expect(editor.keyDown({ key: 'Enter' }, 1)).toBe(true)
      expect(editor.insertText('雪', 1)).toBe(true)
      expect(lookups).toBeGreaterThan(100)
      expect(largest).toBeLessThan(32)
      const saved = source.replace(
        '+ [ ] Task 500 café 😀',
        '+ [ ] Task 500 café 😀\r\n+ [ ] 雪',
      )
      expect(editor.snapshot().text).toBe(saved)
      let undos = 0
      while (editor.snapshot().dirty && undos++ < 5)
        expect(editor.undo()).toBe(true)
      expect(editor.snapshot().text).toBe(source)
      for (let step = 0; step < undos; step++) expect(editor.redo()).toBe(true)
      expect(editor.snapshot().text).toBe(saved)
      editor.loadDocument({
        documentId: 'reopened',
        generation: 2,
        format: 'md',
        text: saved,
      })
      expect(editor.snapshot().text).toBe(saved)
    } finally {
      spy.mockRestore()
    }
  })
})
