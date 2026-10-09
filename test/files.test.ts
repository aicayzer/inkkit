import { expect, test, vi } from 'vitest'
import {
  InkKitEditor,
  type FileAdapter,
  type FileContext,
  type FilePresentation,
  type FileReference,
  type ImageAdapter,
} from '../src/index'
import {
  FileResolution,
  resolveFile,
  withFileSignal,
  type FileViewRuntime,
} from '../src/files'
import { defaultLabels } from '../src/labels'

const reference: FileReference = { reference: 'opaque', kind: 'path' }
const context = () => ({
  documentId: 'files',
  generation: 1,
  operationId: 'resolve',
  signal: new AbortController().signal,
})
const image: FilePresentation = {
  kind: 'image',
  url: 'blob:fixture-image',
  mimeType: 'image/png',
}
const source = {
  documentId: 'files',
  generation: 1,
  format: 'md' as const,
  text: '![Authored|120](opaque)\n',
}

function controlled() {
  const requests: {
    reference: FileReference
    context: FileContext
    resolve(value: FilePresentation): void
  }[] = []
  let epoch = 0
  let active = true
  const adapter: FileAdapter = {
    resolve: (reference, context) =>
      new Promise((resolve) => requests.push({ reference, context, resolve })),
  }
  const runtime: FileViewRuntime = {
    adapter,
    capture: () => {
      const captured = epoch
      return {
        context: {
          documentId: 'files',
          generation: 1,
          operationId: String(requests.length),
        },
        isCurrent: () => epoch === captured,
      }
    },
    active: () => active,
    labels: defaultLabels,
  }
  return {
    requests,
    runtime,
    advance: () => {
      epoch += 1
    },
    setActive: (value: boolean) => {
      active = value
    },
  }
}

test('resolution retries abort old requests and reject late reference/document results', async () => {
  const fixture = controlled()
  const resolver = new FileResolution(fixture.runtime, () => {})
  resolver.update(reference)
  resolver.retry()
  expect(fixture.requests[0]!.context.signal.aborted).toBe(true)
  fixture.requests[0]!.resolve(image)
  await Promise.resolve()
  expect(resolver.state.status).toBe('loading')
  resolver.update({ reference: 'other', kind: 'wiki', fragment: 'page=2' })
  expect(fixture.requests[1]!.context.signal.aborted).toBe(true)
  fixture.requests[1]!.resolve(image)
  fixture.advance()
  fixture.requests[2]!.resolve(image)
  await vi.waitFor(() => expect(resolver.state.status).toBe('loading'))
  resolver.update({ reference: 'other', kind: 'wiki', fragment: 'page=2' })
  expect(fixture.requests).toHaveLength(4)
  fixture.requests[3]!.resolve({ kind: 'file', label: 'Current file' })
  await vi.waitFor(() =>
    expect(resolver.state).toEqual({
      status: 'resolved',
      presentation: { kind: 'file', label: 'Current file' },
    }),
  )
  resolver.destroy()
  expect(fixture.requests[3]!.context.signal.aborted).toBe(true)
})

test('presentation changes do not resolve the same bytes again and inactive views cannot restart', async () => {
  const fixture = controlled()
  const resolver = new FileResolution(fixture.runtime, () => {})
  resolver.update({ ...reference, width: 120 })
  fixture.requests[0]!.resolve(image)
  await vi.waitFor(() => expect(resolver.state.status).toBe('resolved'))
  resolver.update({ ...reference, width: 240, label: 'Updated label' })
  expect(fixture.requests).toHaveLength(1)
  fixture.setActive(false)
  resolver.cancel()
  resolver.retry()
  expect(fixture.requests).toHaveLength(1)
  expect(fixture.requests[0]!.context.signal.aborted).toBe(true)
  fixture.setActive(true)
  resolver.update(reference)
  expect(fixture.requests).toHaveLength(2)
  resolver.destroy()
  fixture.requests[1]!.resolve(image)
  await Promise.resolve()
  expect(resolver.state.status).toBe('idle')
})

test.each([
  { kind: 'image', url: 'javascript:alert(1)' },
  { kind: 'pdf', url: 'data:text/html,<script>bad()</script>' },
  { kind: 'audio', url: 'blob:fixture', mimeType: 'text/html' },
  { kind: 'pdf', url: 'blob:fixture', mimeType: 'application/pdfhtml' },
  { kind: 'image', url: '' },
  { kind: 'unsupported' },
])(
  'unusable adapter presentations reject without loading %j',
  async (presentation) => {
    await expect(
      resolveFile(
        { resolve: async () => presentation as FilePresentation },
        reference,
        context(),
      ),
    ).rejects.toThrow()
  },
)

test('aborted exports reject late adapter results without guessing presentation kind', async () => {
  let complete!: (value: FilePresentation) => void
  const controller = new AbortController()
  const result = resolveFile(
    {
      resolve: () =>
        new Promise((resolve) => {
          complete = resolve
        }),
    },
    reference,
    { ...context(), signal: controller.signal },
  )
  controller.abort()
  complete(image)
  await expect(result).rejects.toMatchObject({ name: 'AbortError' })
  const missing = { kind: 'missing' as const, label: 'Lost document' }
  expect(
    await resolveFile({ resolve: async () => missing }, reference, context()),
  ).toEqual(missing)
})

test('cancellation settles promptly even when a host ignores abort or later rejects', async () => {
  let lateFailure!: (error: Error) => void
  const controller = new AbortController()
  const operation = withFileSignal(
    new Promise((_, reject) => {
      lateFailure = reject
    }),
    controller.signal,
  )
  const rejection = expect(operation).rejects.toMatchObject({
    name: 'AbortError',
  })
  controller.abort()
  await rejection
  lateFailure(new Error('Late host failure'))
  await Promise.resolve()
})

async function mounted(
  files: FileAdapter | undefined,
  body: (editor: InkKitEditor, root: HTMLElement) => Promise<void>,
  options: {
    text?: string
    images?: ImageAdapter
    error?: (error: Error) => void
  } = {},
) {
  const root = document.createElement('div')
  document.body.append(root)
  const editor = await InkKitEditor.mount(
    root,
    {
      changed() {},
      stateChanged() {},
      copy() {},
      openLink() {},
      error: options.error,
    },
    { files, images: options.images },
  )
  try {
    editor.loadDocument({ ...source, text: options.text ?? source.text })
    await body(editor, root)
  } finally {
    await editor.destroy()
    root.remove()
  }
}

test.each(['image', 'audio', 'video', 'pdf', 'file'] as const)(
  'controlled %s view retains source and routes host actions in read-only',
  async (kind) => {
    const pause = vi
      .spyOn(HTMLMediaElement.prototype, 'pause')
      .mockImplementation(() => {})
    const load = vi
      .spyOn(HTMLMediaElement.prototype, 'load')
      .mockImplementation(() => {})
    const open = vi.fn()
    const contextMenu = vi.fn()
    try {
      await mounted(
        {
          resolve: async () =>
            kind === 'file'
              ? { kind, label: 'Useful name' }
              : { kind, url: `blob:fixture-${kind}`, label: 'Useful name' },
          open,
          contextMenu,
        },
        async (editor, root) => {
          await vi.waitFor(() =>
            expect(
              root
                .querySelector('[data-inkkit-file-kind]')
                ?.getAttribute('data-inkkit-file-kind'),
            ).toBe(kind),
          )
          expect(editor.snapshot().text).toBe(source.text)
          const media = root.querySelector(
            'audio,video',
          ) as HTMLMediaElement | null
          if (media) {
            expect(media.controls).toBe(true)
            expect(media.autoplay).toBe(false)
            expect(media.preload).toBe('metadata')
            editor.insertText('Before ', 1)
            expect(root.querySelector('audio,video')).toBe(media)
          }
          const snapshot = editor.snapshot()
          if (kind === 'pdf') {
            expect(root.querySelector('iframe')?.getAttribute('sandbox')).toBe(
              '',
            )
            const fallback = root.querySelector('.inkkit-file-label')!
            expect(fallback.textContent).toBe(
              'Useful name: Open to view this PDF',
            )
            expect(fallback.closest('iframe')).toBeNull()
          }
          editor.setEditable(false)
          const openButton = [...root.querySelectorAll('button')].find(
            (button) => button.textContent === 'Open',
          )!
          openButton.click()
          expect(open).toHaveBeenCalledWith(
            expect.objectContaining(reference),
            expect.objectContaining({ documentId: 'files', generation: 1 }),
          )
          root.querySelector('.inkkit-file')!.dispatchEvent(
            new MouseEvent('contextmenu', {
              bubbles: true,
              cancelable: true,
              clientX: 12,
              clientY: 34,
            }),
          )
          expect(contextMenu).toHaveBeenCalledWith(
            expect.objectContaining(reference),
            { clientX: 12, clientY: 34 },
            expect.anything(),
          )
          expect(editor.snapshot()).toEqual(snapshot)
          if (media) expect(pause).not.toHaveBeenCalled()
          editor.setEditingMode('source')
          if (media) {
            expect(pause).toHaveBeenCalled()
            expect(media.hasAttribute('src')).toBe(false)
          }
          expect(
            root.querySelector(
              '.inkkit-file audio, .inkkit-file video, .inkkit-file iframe, .inkkit-file img',
            ),
          ).toBeNull()
          editor.setEditingMode('formatted')
          await vi.waitFor(() =>
            expect(
              root
                .querySelector('.inkkit-file')
                ?.getAttribute('data-inkkit-file-state'),
            ).toBe('resolved'),
          )
          expect(editor.snapshot()).toEqual(snapshot)
        },
      )
    } finally {
      pause.mockRestore()
      load.mockRestore()
    }
  },
)

test('host action failures are reported without escaping the view or changing source', async () => {
  const error = vi.fn()
  await mounted(
    {
      resolve: async () => ({ kind: 'file', label: 'Useful name' }),
      open() {
        throw new Error('Host opening failed')
      },
      contextMenu() {
        throw 'Host menu failed'
      },
    },
    async (editor, root) => {
      await vi.waitFor(() =>
        expect(
          root.querySelector('[data-inkkit-file-state="resolved"]'),
        ).not.toBeNull(),
      )
      const before = editor.snapshot()
      editor.setEditable(false)
      root.querySelector<HTMLButtonElement>('.inkkit-file-control')!.click()
      root
        .querySelector('.inkkit-file')!
        .dispatchEvent(
          new MouseEvent('contextmenu', { bubbles: true, cancelable: true }),
        )
      expect(error.mock.calls.map(([failure]) => failure.message)).toEqual([
        'Host opening failed',
        'Host menu failed',
      ])
      expect(editor.snapshot()).toEqual(before)
    },
    { error },
  )
})

test('new and undo-restored folded embeds abort held resolution after attaching to the document', async () => {
  const requests: {
    context: FileContext
    complete(value: FilePresentation): void
  }[] = []
  const folded = '> [!NOTE]- Hidden\n> ![[Hidden]]\n'
  await mounted(
    {
      resolve: (_reference, context) =>
        new Promise((complete) => requests.push({ context, complete })),
    },
    async (editor, root) => {
      editor.replaceSource(folded)
      expect(requests).toHaveLength(1)
      await vi.waitFor(() =>
        expect(requests[0]!.context.signal.aborted).toBe(true),
      )
      expect(root.querySelector('[data-inkkit-folded="true"]')).not.toBeNull()
      expect(editor.snapshot().text).toBe(folded)
      editor.replaceSource('Visible text\n')
      expect(editor.undo()).toBe(true)
      expect(editor.snapshot().text).toBe(folded)
      expect(requests).toHaveLength(2)
      await vi.waitFor(() =>
        expect(requests[1]!.context.signal.aborted).toBe(true),
      )
      for (const request of requests)
        request.complete({ kind: 'audio', url: 'blob:stale-hidden-audio' })
      await Promise.resolve()
      expect(root.querySelector('audio')).toBeNull()
      expect(editor.snapshot().text).toBe(folded)
      expect(editor.undo()).toBe(true)
      expect(editor.snapshot().text).toBe('Visible text\n')
    },
    { text: 'Visible text\n' },
  )
})

test('missing, failed and undecodable files provide retry without changing authored source', async () => {
  let attempts = 0
  await mounted(
    {
      resolve: async () => {
        attempts += 1
        if (attempts === 1) return { kind: 'missing', label: 'Missing name' }
        if (attempts === 2) throw Error('Storage unavailable')
        return image
      },
    },
    async (editor, root) => {
      const retry = () =>
        [...root.querySelectorAll('button')]
          .find((button) => button.textContent === 'Retry')!
          .click()
      await vi.waitFor(() =>
        expect(root.textContent).toContain('File unavailable'),
      )
      const before = editor.snapshot()
      retry()
      await vi.waitFor(() =>
        expect(root.textContent).toContain('File could not be loaded'),
      )
      retry()
      await vi.waitFor(() =>
        expect(root.querySelector('.image img')).not.toBeNull(),
      )
      root.querySelector('.image img')!.dispatchEvent(new Event('error'))
      expect(root.textContent).toContain('Preview unavailable')
      expect(root.querySelector('.image img')).toBeNull()
      expect(editor.snapshot()).toEqual(before)
    },
  )
})

test('same-generation reload and source mode abort held requests; late results cannot populate the new view', async () => {
  const requests: {
    context: FileContext
    complete(value: FilePresentation): void
  }[] = []
  await mounted(
    {
      resolve: (_reference, context) =>
        new Promise((complete) => requests.push({ context, complete })),
    },
    async (editor, root) => {
      expect(requests).toHaveLength(1)
      editor.reloadDocument(source)
      expect(requests[0]!.context.signal.aborted).toBe(true)
      expect(requests).toHaveLength(2)
      requests[0]!.complete(image)
      await Promise.resolve()
      expect(root.querySelector('.image img')).toBeNull()
      editor.setEditingMode('source')
      expect(requests[1]!.context.signal.aborted).toBe(true)
      requests[1]!.complete(image)
      editor.setEditingMode('formatted')
      expect(requests).toHaveLength(3)
      requests[2]!.complete(image)
      await vi.waitFor(() =>
        expect(root.querySelector('.image img')).not.toBeNull(),
      )
      expect(editor.snapshot().text).toBe(source.text)
    },
  )
})

test('disabled files retain legacy ImageAdapter presentation without a file-resolution pipeline', async () => {
  const images: ImageAdapter = {
    presentation: () => ({ url: 'private://legacy/image' }),
    importImage: async () => ({ reference: 'legacy' }),
    exportImage: async () => ({
      bytes: new Uint8Array([1]),
      mimeType: 'image/png',
    }),
  }
  await mounted(
    undefined,
    async (editor, root) => {
      expect(root.querySelector('.image img')?.getAttribute('src')).toBe(
        'private://legacy/image',
      )
      expect(root.querySelector('.inkkit-file')).toBeNull()
      expect(editor.snapshot().text).toBe(source.text)
    },
    { images },
  )
})

test('folded callouts stop media resources and reopen without changing source', async () => {
  const pause = vi
    .spyOn(HTMLMediaElement.prototype, 'pause')
    .mockImplementation(() => {})
  const load = vi
    .spyOn(HTMLMediaElement.prototype, 'load')
    .mockImplementation(() => {})
  try {
    await mounted(
      { resolve: async () => ({ kind: 'audio', url: 'blob:fixture-audio' }) },
      async (editor, root) => {
        await vi.waitFor(() =>
          expect(root.querySelector('audio')).not.toBeNull(),
        )
        const before = editor.snapshot()
        const media = root.querySelector('audio')!
        const toggle = root.querySelector<HTMLButtonElement>(
          '[data-inkkit-callout-toggle]',
        )!
        toggle.click()
        expect(pause).toHaveBeenCalled()
        expect(media.hasAttribute('src')).toBe(false)
        expect(root.querySelector('audio')).toBeNull()
        expect(editor.snapshot()).toEqual(before)
        toggle.click()
        await vi.waitFor(() =>
          expect(root.querySelector('audio')).not.toBeNull(),
        )
        expect(editor.snapshot()).toEqual(before)
      },
      { text: '> [!NOTE]+ Media\n> ![Audio](opaque)\n' },
    )
  } finally {
    pause.mockRestore()
    load.mockRestore()
  }
})

test('legacy resize obeys pending-import and composition guards through gesture completion', async () => {
  let complete!: (value: { reference: string }) => void
  const images: ImageAdapter = {
    presentation: () => ({ url: 'private://legacy/image' }),
    importImage: () =>
      new Promise((resolve) => {
        complete = resolve
      }),
    exportImage: async () => ({
      bytes: new Uint8Array([1]),
      mimeType: 'image/png',
    }),
  }
  await mounted(
    undefined,
    async (editor, root) => {
      const before = editor.snapshot()
      const surface = root.querySelector('.ProseMirror')!
      Object.defineProperty(surface, 'clientWidth', { value: 500 })
      const begin = () => {
        const image = root.querySelector<HTMLImageElement>('.image img')!
        image.getBoundingClientRect = () => new DOMRect(0, 0, 120, 80)
        const handle = root.querySelector('.image-handle')!
        handle.dispatchEvent(
          new MouseEvent('pointerdown', {
            bubbles: true,
            cancelable: true,
            clientX: 100,
          }),
        )
        handle.dispatchEvent(new MouseEvent('pointermove', { clientX: 160 }))
        return handle
      }
      const pending = editor.paste({
        text: '',
        images: [{ bytes: new Uint8Array([1]), mimeType: 'image/png' }],
      })
      const rejection = expect(pending).rejects.toMatchObject({
        code: 'stale-document',
      })
      begin().dispatchEvent(new MouseEvent('pointerup', { clientX: 160 }))
      expect(
        root.querySelector<HTMLImageElement>('.image img')!.style.width,
      ).toBe('120px')
      editor.setEditable(false)
      editor.setEditable(true)
      complete({ reference: 'late-import' })
      await rejection
      expect(editor.snapshot()).toEqual(before)
      surface.dispatchEvent(
        new CompositionEvent('compositionstart', { bubbles: true }),
      )
      begin().dispatchEvent(new MouseEvent('pointerup', { clientX: 160 }))
      surface.dispatchEvent(
        new CompositionEvent('compositionend', { bubbles: true }),
      )
      expect(editor.snapshot()).toEqual(before)
      const handle = begin()
      expect(
        root.querySelector<HTMLImageElement>('.image img')!.style.width,
      ).toBe('180px')
      surface.dispatchEvent(
        new CompositionEvent('compositionstart', { bubbles: true }),
      )
      handle.dispatchEvent(new MouseEvent('pointerup', { clientX: 160 }))
      surface.dispatchEvent(
        new CompositionEvent('compositionend', { bubbles: true }),
      )
      expect(
        root.querySelector<HTMLImageElement>('.image img')!.style.width,
      ).toBe('120px')
      expect(editor.snapshot()).toEqual(before)
      expect(editor.undo()).toBe(false)
    },
    { images },
  )
})

test.each([
  '![Photo|120](opaque#fragment)\n',
  '![[Photo#fragment|120]]\n',
  '![[file\\|400]]\n',
])(
  'resize is isolated from typing and cancellation is non-mutating: %s',
  async (text) => {
    await mounted(
      { resolve: async () => image },
      async (editor, root) => {
        await vi.waitFor(() =>
          expect(root.querySelector('.image img')).not.toBeNull(),
        )
        const original = editor.snapshot().text
        editor.insertText('Before ', 1)
        const typed = editor.snapshot().text
        const resize = (finish: 'pointerup' | 'pointercancel') => {
          const image = root.querySelector('.image img')!
          image.getBoundingClientRect = () => new DOMRect(0, 0, 120, 80)
          Object.defineProperty(
            root.querySelector('.ProseMirror')!,
            'clientWidth',
            { value: 500, configurable: true },
          )
          const handle = root.querySelector('.image-handle')!
          handle.dispatchEvent(
            new MouseEvent('pointerdown', {
              clientX: 100,
              bubbles: true,
              cancelable: true,
            }),
          )
          handle.dispatchEvent(new MouseEvent('pointermove', { clientX: 160 }))
          handle.dispatchEvent(new MouseEvent(finish, { clientX: 160 }))
        }
        resize('pointercancel')
        expect(editor.snapshot().text).toBe(typed)
        resize('pointerup')
        expect(editor.snapshot().text).toContain('|180')
        if (text.includes('#'))
          expect(editor.snapshot().text).toContain('#fragment')
        expect(editor.undo()).toBe(true)
        expect(editor.snapshot().text).toBe(typed)
        expect(editor.undo()).toBe(true)
        expect(editor.snapshot().text).toBe(original)
      },
      { text },
    )
  },
)
