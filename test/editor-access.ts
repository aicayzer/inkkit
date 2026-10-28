import { afterAll, beforeAll } from 'vitest'
import type { InkKitEditor } from '../src/core'

// Keep the structural test seam here so refactors cannot leave handwritten
// copies of the editor's private types scattered through the suite.
export const ctxOf = (editor: InkKitEditor) => editor['editor'].ctx
export const optionsOf = (editor: InkKitEditor) => editor['options']
export const importsOf = (editor: InkKitEditor) => editor['pasteController']

async function mountFacade(text: string) {
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
  } catch (error) {
    await editor.destroy()
    root.remove()
    throw error
  }
  return {
    editor,
    async destroy() {
      await editor.destroy()
      root.remove()
    },
  }
}

export async function withFacade<T>(
  text: string,
  run: (editor: InkKitEditor) => T | Promise<T>,
): Promise<T> {
  const mounted = await mountFacade(text)
  try {
    return await run(mounted.editor)
  } finally {
    await mounted.destroy()
  }
}

// Generated cases share assembly, but each loads its source through the facade,
// which clears selection, history, pending imports and the previous generation.
export function facadeFixture(text: string): () => InkKitEditor {
  let mounted: Awaited<ReturnType<typeof mountFacade>> | undefined
  beforeAll(async () => {
    mounted = await mountFacade(text)
  })
  afterAll(async () => {
    await mounted?.destroy()
  })
  return () => mounted!.editor
}
