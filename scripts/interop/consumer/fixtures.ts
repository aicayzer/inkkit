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

const videoData =
  'AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAAM2bW9vdgAAAGxtdmhkAAAAAAAAAAAAAAAAAAAD6AAAA+gAAQAAAQAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAAAmF0cmFrAAAAXHRraGQAAAADAAAAAAAAAAAAAAABAAAAAAAAA+gAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAACAAAAAgAAAAAAAkZWR0cwAAABxlbHN0AAAAAAAAAAEAAAPoAAAAAAABAAAAAAHZbWRpYQAAACBtZGhkAAAAAAAAAAAAAAAAAAAoAAAAKABVxAAAAAAALWhkbHIAAAAAAAAAAHZpZGUAAAAAAAAAAAAAAABWaWRlb0hhbmRsZXIAAAABhG1pbmYAAAAUdm1oZAAAAAEAAAAAAAAAAAAAACRkaW5mAAAAHGRyZWYAAAAAAAAAAQAAAAx1cmwgAAAAAQAAAURzdGJsAAAAuHN0c2QAAAAAAAAAAQAAAKhhdmMxAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAACAAIABIAAAASAAAAAAAAAABFExhdmM2My4xLjEwMiBsaWJ4MjY0AAAAAAAAAAAAAAAAGP//AAAALmF2Y0MBQsAK/+EAFmdCwArZCWwEQAAAAwBAAAADAoPEiZIBAAVoy4PLIAAAABBwYXNwAAAAAQAAAAEAAAAUYnRydAAAAAAAABWoAAAAAAAAABhzdHRzAAAAAAAAAAEAAAAFAAAIAAAAABRzdHNzAAAAAAAAAAEAAAABAAAAHHN0c2MAAAAAAAAAAQAAAAEAAAAFAAAAAQAAAChzdHN6AAAAAAAAAAAAAAAFAAACjgAAAAoAAAAKAAAACgAAAAkAAAAUc3RjbwAAAAAAAAABAAADZgAAAGF1ZHRhAAAAWW1ldGEAAAAAAAAAIWhkbHIAAAAAAAAAAG1kaXJhcHBsAAAAAAAAAAAAAAAALGlsc3QAAAAkqXRvbwAAABxkYXRhAAAAAQAAAABMYXZmNjMuMS4xMDIAAAAIZnJlZQAAAr1tZGF0AAACcAYF//9s3EXpvebZSLeWLNgg2SPu73gyNjQgLSBjb3JlIDE2NSByMzIyMiBiMzU2MDVhIC0gSC4yNjQvTVBFRy00IEFWQyBjb2RlYyAtIENvcHlsZWZ0IDIwMDMtMjAyNSAtIGh0dHA6Ly93d3cudmlkZW9sYW4ub3JnL3gyNjQuaHRtbCAtIG9wdGlvbnM6IGNhYmFjPTAgcmVmPTMgZGVibG9jaz0xOjA6MCBhbmFseXNlPTB4MToweDExMSBtZT1oZXggc3VibWU9NyBwc3k9MSBwc3lfcmQ9MS4wMDowLjAwIG1peGVkX3JlZj0xIG1lX3JhbmdlPTE2IGNocm9tYV9tZT0xIHRyZWxsaXM9MSA4eDhkY3Q9MCBjcW09MCBkZWFkem9uZT0yMSwxMSBmYXN0X3Bza2lwPTEgY2hyb21hX3FwX29mZnNldD0tMiB0aHJlYWRzPTEgbG9va2FoZWFkX3RocmVhZHM9MSBzbGljZWRfdGhyZWFkcz0wIG5yPTAgZGVjaW1hdGU9MSBpbnRlcmxhY2VkPTAgYmx1cmF5X2NvbXBhdD0wIGNvbnN0cmFpbmVkX2ludHJhPTAgYmZyYW1lcz0wIHdlaWdodHA9MCBrZXlpbnQ9MjUwIGtleWludF9taW49NSBzY2VuZWN1dD00MCBpbnRyYV9yZWZyZXNoPTAgcmNfbG9va2FoZWFkPTQwIHJjPWNyZiBtYnRyZWU9MSBjcmY9MjMuMCBxY29tcD0wLjYwIHFwbWluPTAgcXBtYXg9NjkgcXBzdGVwPTQgaXBfcmF0aW89MS40MCBhcT0xOjEuMDAAgAAAABZliIQEfEYoAAxIxwABbWjgACHzJ114AAAABkGaOAj5YAAAAAZBmlQCPlgAAAAGQZpgEPLAAAAABUGagD/L'

export const linkedSource =
  '# Linked files\n\nBefore [[Notes/旅行#Résumé|Travel plan]] after.\n\n' +
  '| Link | Named image |\n| --- | --- |\n| [[Notes/旅行\\|Table alias]] | ![[Photo\\|120]] |\n\n' +
  '![[Photo|140]]\n\n![Path photo|120](images/native.png)\n\n' +
  '![[Voice#t=0,0.5]]\n\n![[Movie#t=0,0.5]]\n\n![[Document#page=1]]\n\n![[Archive]]\n\n' +
  '![[Missing]]\n\n![[Broken]]\n\nUnsupported [[Note#^block]] and ![[Note|caption]].\n'
fixtures['linked-files'] = {
  label: 'Optional linked files and media',
  format: 'md',
  text: linkedSource,
}

type FixtureReference = {
  reference: string
  kind: 'path' | 'wiki'
  fragment?: string
  label?: string
  width?: number
}
type FixtureContext = {
  signal: AbortSignal
  documentId: string
  generation: number
}
export class ControlledFiles {
  readonly events: {
    operation: string
    phase: string
    reference?: string
    documentId?: string
    generation?: number
    fragment?: string
  }[] = []
  private mode: AdapterMode = 'normal'
  private gate?: () => void
  private wait?: Promise<void>
  private urls = new Map<string, string>()
  readonly started = { resolve: false, export: false }
  setMode(mode: AdapterMode) {
    this.release()
    this.mode = mode
    this.started.resolve = this.started.export = false
    if (mode === 'hold')
      this.wait = new Promise<void>((resolve) => {
        this.gate = resolve
      })
  }
  release() {
    this.gate?.()
    this.gate = undefined
    this.wait = undefined
  }
  dispose() {
    this.release()
    for (const url of this.urls.values()) URL.revokeObjectURL(url)
    this.urls.clear()
    this.events.length = 0
  }
  private async pending(
    operation: 'resolve' | 'export',
    reference: FixtureReference,
    context: FixtureContext,
  ) {
    this.started[operation] = true
    this.events.push({
      operation,
      phase: 'started',
      reference: reference.reference,
      documentId: context.documentId,
      generation: context.generation,
      fragment: reference.fragment,
    })
    const abort = () =>
      this.events.push({
        operation,
        phase: 'aborted',
        reference: reference.reference,
        documentId: context.documentId,
      })
    context.signal.addEventListener('abort', abort, { once: true })
    try {
      await this.wait
      if (this.mode === 'reject') throw Error('Controlled file failure')
      this.events.push({
        operation,
        phase: 'completed',
        reference: reference.reference,
      })
    } finally {
      context.signal.removeEventListener('abort', abort)
    }
  }
  private resource(kind: 'image' | 'audio' | 'video' | 'pdf') {
    if (this.urls.has(kind)) return this.urls.get(kind)!
    let bytes: Uint8Array<ArrayBuffer>, mimeType: string
    if (kind === 'image') {
      bytes = imageBytes()
      mimeType = 'image/png'
    } else if (kind === 'video') {
      bytes = Uint8Array.from(atob(videoData), (c) => c.charCodeAt(0))
      mimeType = 'video/mp4'
    } else if (kind === 'audio') {
      bytes = new Uint8Array(44 + 8000)
      const view = new DataView(bytes.buffer)
      for (const [offset, text] of [
        [0, 'RIFF'],
        [8, 'WAVEfmt '],
        [36, 'data'],
      ] as const)
        for (let i = 0; i < text.length; i++)
          bytes[offset + i] = text.charCodeAt(i)
      view.setUint32(4, bytes.length - 8, true)
      view.setUint32(16, 16, true)
      view.setUint16(20, 1, true)
      view.setUint16(22, 1, true)
      view.setUint32(24, 8000, true)
      view.setUint32(28, 8000, true)
      view.setUint16(32, 1, true)
      view.setUint16(34, 8, true)
      view.setUint32(40, 8000, true)
      bytes.fill(128, 44)
      mimeType = 'audio/wav'
    } else {
      const objects = [
        '<< /Type /Catalog /Pages 2 0 R >>',
        '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
        '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R >>',
        '<< /Length 0 >>\nstream\n\nendstream',
      ]
      let pdf = '%PDF-1.4\n',
        offsets = [0]
      objects.forEach((object, index) => {
        offsets.push(pdf.length)
        pdf += `${index + 1} 0 obj\n${object}\nendobj\n`
      })
      const xref = pdf.length
      pdf += `xref\n0 5\n0000000000 65535 f \n${offsets
        .slice(1)
        .map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`)
        .join(
          '',
        )}trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
      bytes = new TextEncoder().encode(pdf)
      mimeType = 'application/pdf'
    }
    const url = URL.createObjectURL(new Blob([bytes], { type: mimeType }))
    this.urls.set(kind, url)
    return url
  }
  readonly adapter = {
    resolve: async (reference: FixtureReference, context: FixtureContext) => {
      await this.pending('resolve', reference, context)
      const name = reference.reference.split('#')[0]!
      const label = reference.label || name
      if (name === 'Missing') return { kind: 'missing' as const, label }
      if (name === 'Broken')
        return {
          kind: 'error' as const,
          label,
          message: 'Controlled missing bytes',
        }
      if (name === 'Archive') return { kind: 'file' as const, label }
      const kind =
        name === 'Voice'
          ? 'audio'
          : name === 'Movie'
            ? 'video'
            : name === 'Document'
              ? 'pdf'
              : 'image'
      return {
        kind: kind as 'image' | 'audio' | 'video' | 'pdf',
        label,
        url:
          this.mode === 'corrupt'
            ? 'data:application/octet-stream;base64,AA=='
            : this.resource(kind) +
              (reference.fragment ? `#${reference.fragment}` : ''),
      }
    },
    exportImage: async (
      reference: FixtureReference,
      context: FixtureContext,
    ) => {
      await this.pending('export', reference, context)
      return {
        bytes:
          this.mode === 'corrupt' ? imageBytes().subarray(0, 24) : imageBytes(),
        mimeType: 'image/png',
      }
    },
    open: (
      reference: FixtureReference,
      context: { documentId: string; generation: number },
    ) => {
      this.events.push({
        operation: 'open',
        phase: 'activated',
        reference: reference.reference,
        fragment: reference.fragment,
        documentId: context.documentId,
        generation: context.generation,
      })
    },
    contextMenu: (
      reference: FixtureReference,
      _point: { clientX: number; clientY: number },
      context: { documentId: string; generation: number },
    ) => {
      this.events.push({
        operation: 'contextMenu',
        phase: 'activated',
        reference: reference.reference,
        documentId: context.documentId,
      })
    },
  }
  readonly wiki = {
    resolve: (reference: { target: string }) => ({
      missing: reference.target === 'Missing note',
    }),
    open: (
      reference: { target: string; fragment?: string },
      context: { documentId: string; generation: number },
    ) => {
      this.events.push({
        operation: 'wikiOpen',
        phase: 'activated',
        reference: reference.target,
        fragment: reference.fragment,
        documentId: context.documentId,
      })
    },
  }
}
