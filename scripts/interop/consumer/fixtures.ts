export const imageData =
  'iVBORw0KGgoAAAANSUhEUgAAAFAAAAAoCAYAAABpYH0BAAAAAXNSR0IArs4c6QAAADhlWElmTU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAAqACAAQAAAABAAAAUKADAAQAAAABAAAAKAAAAADbisV7AAAAlUlEQVRoBe3SMQ0AIQAEQR4X6MC/Nj5BAtvO9dtM7jtrn2HPAvO5FF4BgPEIAAFGgZh7IMAoEHMPBBgFYu6BAKNAzD0QYBSIuQcCjAIx90CAUSDmHggwCsTcAwFGgZh7IMAoEHMPBBgFYu6BAKNAzD0QYBSIuQcCjAIx90CAUSDmHggwCsTcAwFGgZh7IMAoEHMPjIA/2VgCmiePpoIAAAAASUVORK5CYII='
export const imageBytes = () =>
  Uint8Array.from(atob(imageData), (character) => character.charCodeAt(0))

export interface Fixture {
  label: string
  format: 'md' | 'txt'
  text: string
}
export const wrappedSearchText =
  'Wrapped match spans several visual lines so its first and final character must both fit below the host search header and above the bottom inset.'
export const fixtures: Record<string, Fixture> = {
  'native-search': {
    label: 'Native search and viewport',
    format: 'md',
    text:
      '# Native search\n\nUnicode: A😀B é 👨‍👩‍👧‍👦 中文.\n\n**Formatted match** and `code match`.\n\n> [!NOTE]- Folded\n> Hidden body match.\n\n<!-- hidden author comment -->\n\n![Opaque image](images/native.png)\n\n' +
      Array.from(
        { length: 36 },
        (_, index) =>
          `Paragraph ${index + 1}: scrollable fixture content.\n${index === 28 ? `\n${wrappedSearchText}\n` : ''}`,
      ).join('\n') +
      '\nFinal navigation target.\n',
  },
  everyday: {
    label: 'Everyday Markdown',
    format: 'md',
    text: '# InkKit\n\nEdit, copy and paste here.\n\nA **bold** word and an [example](https://example.com).\n\n- [ ] First task\n- [x] Finished task\n',
  },
  tables: {
    label: 'Tables',
    format: 'md',
    text: '| Name | Value |\n| --- | ---: |\n| Alice | 42 |\n| Bob | 7 |\n',
  },
  references: {
    label: 'Footnotes and callouts',
    format: 'md',
    text: 'Before [Alpha][Authored], repeated[^Note].\n\n> [!NOTE]- Folded\n> ## Nested\n> Body\n\n[Authored]: <https://example.com/original> "Shared title"\n\n[^Note]: Footnote body.\n\n    Second paragraph.\n',
  },
  mermaid: {
    label: 'Mermaid',
    format: 'md',
    text: '# Diagram\n\n```mermaid\nflowchart LR\n  A[Start] --> B[Finish]\n```\n',
  },
  images: {
    label: 'Opaque image references',
    format: 'md',
    text: '# Images\n\n![Fixture](images/native.png)\n',
  },
  txt: {
    label: 'Literal TXT',
    format: 'txt',
    text: '\uFEFF# Literal\r\n**raw** <html> [link][missing]\r\n',
  },
  unsupported: {
    label: 'Unsupported syntax',
    format: 'md',
    text: '# Preserved\n\n<div data-custom="untouched">\nRaw **HTML**\n</div>\n\n[Unresolved][Missing]\n\n<!-- private comment -->\n',
  },
  untidy: {
    label: 'Untidy authored source',
    format: 'md',
    text: '\uFEFF#  Authored heading  \r\n\r\nBefore [Alpha][Authored].\r\n\r\n[Authored]: <https://example.com/original> "Shared title"\r\n\r\n[Unused]: https://example.com/unused\r\n',
  },
}
export const configurations = ['minimal', 'rich'] as const
export type AdapterMode = 'normal' | 'reject' | 'hold' | 'corrupt'
export type FixtureImage = { bytes: Uint8Array; mimeType: string }
export class ControlledImages {
  readonly imported = new Map<string, FixtureImage>()
  readonly events: { operation: string; phase: string; reference?: string }[] =
    []
  private epoch = 0
  private gates = new Map<'import' | 'export', () => void>()
  private waits = new Map<'import' | 'export', Promise<void>>()
  private modes: Record<'import' | 'export', AdapterMode> = {
    import: 'normal',
    export: 'normal',
  }
  readonly started = { import: false, export: false }
  setMode(operation: 'import' | 'export', mode: AdapterMode) {
    this.release(operation)
    this.started[operation] = false
    this.modes[operation] = mode
    if (mode === 'hold')
      this.waits.set(
        operation,
        new Promise<void>((resolve) => this.gates.set(operation, resolve)),
      )
  }
  release(operation: 'import' | 'export') {
    this.gates.get(operation)?.()
    this.gates.delete(operation)
    this.waits.delete(operation)
  }
  dispose() {
    this.epoch++
    this.release('import')
    this.release('export')
    this.imported.clear()
    this.events.length = 0
    this.modes = { import: 'normal', export: 'normal' }
    this.started.import = this.started.export = false
  }
  private async wait(operation: 'import' | 'export', reference?: string) {
    const epoch = this.epoch
    this.started[operation] = true
    this.events.push({ operation, phase: 'started', reference })
    await this.waits.get(operation)
    if (epoch !== this.epoch) throw Error('Fixture resources disposed')
    if (this.modes[operation] === 'reject') {
      this.events.push({ operation, phase: 'rejected', reference })
      throw Error('Fixture image unavailable')
    }
    this.events.push({ operation, phase: 'completed', reference })
  }
  readonly adapter = {
    presentation: (reference: string) => {
      const image = this.imported.get(reference)
      return {
        url: image
          ? `data:${image.mimeType};base64,${btoa(String.fromCharCode(...image.bytes))}`
          : `data:image/png;base64,${imageData}`,
      }
    },
    importImage: async (input: FixtureImage) => {
      await this.wait('import')
      const reference = `images/imported-${this.imported.size}.png`
      this.imported.set(reference, {
        bytes: input.bytes.slice(),
        mimeType: input.mimeType,
      })
      return { reference }
    },
    exportImage: async (reference: string) => {
      await this.wait('export', reference)
      if (this.modes.export === 'corrupt')
        return { bytes: imageBytes().subarray(0, 24), mimeType: 'image/png' }
      return (
        this.imported.get(reference) ?? {
          bytes: imageBytes(),
          mimeType: 'image/png',
        }
      )
    },
  }
}
