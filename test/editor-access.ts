import type { InkKitEditor } from '../src/core'

// Keep the structural test seam here so refactors cannot leave handwritten
// copies of the editor's private types scattered through the suite.
export const ctxOf = (editor: InkKitEditor) => editor['editor'].ctx
export const optionsOf = (editor: InkKitEditor) => editor['options']
export const importsOf = (editor: InkKitEditor) => editor['pasteController']

export async function withFacade<T>(
  text: string,
  run: (editor: InkKitEditor) => T | Promise<T>,
): Promise<T> {
  const { InkKitEditor } = await import('../src/core')
  const root = document.createElement('div')
  document.body.append(root)
  const editor = await InkKitEditor.mount(root, { changed() {} })
  try {
    editor.loadDocument({
      documentId: 'test',
      generation: 1,
      format: 'md',
      text,
    })
    return await run(editor)
  } finally {
    await editor.destroy()
    root.remove()
  }
}
