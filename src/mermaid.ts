import { editorLabels } from './labels'
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import { Plugin, PluginKey } from '@milkdown/kit/prose/state'
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view'
import { $prose } from '@milkdown/kit/utils'
import { InkKitError, type PortableImage } from './types'
import { themedDiagram, type DiagramTheme } from './diagram-theme'

export function isMermaid(node: ProseNode): boolean {
  return node.type.name === 'code_block' && node.attrs.language === 'mermaid'
}

type DiagramRenderer = (source: string) => string | Promise<string>
let renderer: DiagramRenderer | undefined

// Only the main entry registers the renderer and its sanitiser.
export function registerDiagram(render: DiagramRenderer): void {
  renderer = render
}
export const diagramsAvailable = (): boolean => renderer !== undefined

export async function renderDiagram(source: string): Promise<string> {
  if (!renderer)
    throw new Error(
      'Diagram rendering is not included in this build. The source is retained.',
    )
  return renderer(source)
}

/** Geometry belongs to one document, independently of its visible previews. */
export class DiagramStore {
  private readonly entries = new Map<string, Promise<string>>()
  private generation = 0
  private destroyed = false

  get epoch(): number {
    return this.generation
  }

  render(source: string): Promise<string> {
    if (this.destroyed)
      return Promise.reject(new Error('The diagram document was destroyed.'))
    const key = source.replace(/\r\n?/g, '\n')
    const previous = this.entries.get(key)
    if (previous) return previous
    const generation = this.generation
    const pending = Promise.resolve()
      .then(() => {
        if (
          this.destroyed ||
          generation !== this.generation ||
          this.entries.get(key) !== pending
        )
          throw new Error('The diagram is no longer current.')
        return renderDiagram(key)
      })
      .then((svg) => {
        if (
          this.destroyed ||
          generation !== this.generation ||
          this.entries.get(key) !== pending
        )
          throw new Error('The diagram is no longer current.')
        return svg
      })
    this.entries.set(key, pending)
    void pending.catch(() => {
      if (this.entries.get(key) === pending) this.entries.delete(key)
    })
    return pending
  }

  reconcile(doc: ProseNode): void {
    const sources = new Set<string>()
    doc.descendants((node) => {
      if (isMermaid(node)) sources.add(node.textContent.replace(/\r\n?/g, '\n'))
    })
    for (const key of this.entries.keys())
      if (!sources.has(key)) this.entries.delete(key)
  }

  clear(): void {
    this.generation++
    this.entries.clear()
  }

  destroy(): void {
    this.destroyed = true
    this.clear()
  }
}

export async function diagramImage(
  source: string,
  store?: DiagramStore,
  root?: HTMLElement,
  theme?: DiagramTheme,
): Promise<PortableImage> {
  const svg = themedDiagram(
    await (store ? store.render(source) : renderDiagram(source)),
    root,
    true,
    theme,
  )
  const parsed = new DOMParser().parseFromString(
    svg,
    'image/svg+xml',
  ).documentElement
  const bounds = (parsed.getAttribute('viewBox') ?? '')
    .split(/[\s,]+/)
    .map(Number)
  const width =
    bounds[2] || Number.parseFloat(parsed.getAttribute('width') ?? '')
  const height =
    bounds[3] || Number.parseFloat(parsed.getAttribute('height') ?? '')
  if (!(width > 0 && height > 0 && Number.isFinite(width + height)))
    throw new Error('The rendered diagram has no usable dimensions.')
  const scale = Math.min(2, 4096 / width, 4096 / height)
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.ceil(width * scale))
  canvas.height = Math.max(1, Math.ceil(height * scale))
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Portable diagram output is unavailable.')
  parsed.setAttribute('width', String(width))
  parsed.setAttribute('height', String(height))
  const image = new Image()
  const url = URL.createObjectURL(
    new Blob([new XMLSerializer().serializeToString(parsed)], {
      type: 'image/svg+xml',
    }),
  )
  try {
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve()
      image.onerror = () =>
        reject(new Error('The diagram image could not be rendered.'))
      image.src = url
    })
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    const data = canvas.toDataURL('image/png').split(',')[1]
    if (!data) throw new Error('The diagram image could not be exported.')
    return {
      bytes: Uint8Array.from(atob(data), (character) =>
        character.charCodeAt(0),
      ),
      mimeType: 'image/png',
      filename: 'diagram.png',
    }
  } finally {
    URL.revokeObjectURL(url)
  }
}

interface PreviewJob {
  element: HTMLElement
  source: string
  visible: boolean
  active: boolean
  running: boolean
}

export function mermaidPreview(
  store: DiagramStore,
  onError: (error: InkKitError) => void,
) {
  return $prose((ctx) => {
    const jobs = new Set<PreviewJob>()
    let timer: ReturnType<typeof setTimeout> | undefined
    let stopped = false
    let viewGeneration = 0
    const schedule = () => {
      if (!stopped && timer === undefined) timer = setTimeout(run, 0)
    }
    // One layout per task lets input run between diagrams, including on WebKit.
    const run = () => {
      timer = undefined
      if (stopped || document.visibilityState === 'hidden') return
      const job = [...jobs].find(
        (item) =>
          item.active &&
          item.visible &&
          !item.running &&
          item.element.isConnected,
      )
      if (!job) return
      job.running = true
      void store
        .render(job.source)
        .then(
          (svg) => {
            if (!job.active || stopped) return
            job.element.innerHTML = themedDiagram(svg)
            job.element.dataset.state = 'ready'
          },
          (error: unknown) => {
            if (!job.active || stopped) return
            const message =
              error instanceof Error
                ? error.message
                : 'The diagram could not be rendered.'
            job.element.textContent = `${editorLabels(ctx).diagramUnavailable} ${message}`
            job.element.dataset.state = 'error'
            onError(
              new InkKitError('diagram-unavailable', message, { cause: error }),
            )
          },
        )
        .finally(() => {
          jobs.delete(job)
          observer?.unobserve(job.element)
          schedule()
        })
    }
    const observer =
      typeof IntersectionObserver === 'undefined'
        ? undefined
        : new IntersectionObserver((entries) => {
            for (const entry of entries) {
              const job = [...jobs].find(
                (item) => item.element === entry.target,
              )
              if (job) job.visible = entry.isIntersecting
            }
            schedule()
          })
    return new Plugin({
      key: new PluginKey('mermaidPreview'),
      view: (view) => {
        const generation = ++viewGeneration
        stopped = false
        document.addEventListener('visibilitychange', schedule)
        store.reconcile(view.state.doc)
        schedule()
        return {
          update(view, previous) {
            if (view.state.doc !== previous.doc) store.reconcile(view.state.doc)
            schedule()
          },
          destroy() {
            stopped = true
            if (timer !== undefined) clearTimeout(timer)
            timer = undefined
            document.removeEventListener('visibilitychange', schedule)
            // ProseMirror recreates plugin views after updating document widgets.
            // Keep those widgets' jobs when this plugin is immediately rebound.
            queueMicrotask(() => {
              if (generation !== viewGeneration || !stopped) return
              observer?.disconnect()
              for (const job of jobs) job.active = false
              jobs.clear()
            })
          },
        }
      },
      props: {
        decorations(state) {
          const widgets: Decoration[] = []
          state.doc.descendants((node, pos) => {
            if (!isMermaid(node)) return true
            const source = node.textContent
            widgets.push(
              Decoration.widget(
                pos + node.nodeSize,
                () => {
                  const preview = document.createElement('div')
                  preview.className = 'inkkit-mermaid-preview'
                  preview.contentEditable = 'false'
                  preview.textContent = editorLabels(ctx).diagramRendering
                  preview.setAttribute('role', 'status')
                  preview.setAttribute('aria-live', 'polite')
                  const job: PreviewJob = {
                    element: preview,
                    source,
                    active: true,
                    visible: !observer,
                    running: false,
                  }
                  jobs.add(job)
                  ;(preview as HTMLElement & { cancel?: () => void }).cancel =
                    () => {
                      job.active = false
                      jobs.delete(job)
                      observer?.unobserve(preview)
                    }
                  observer?.observe(preview)
                  schedule()
                  return preview
                },
                {
                  key: `mermaid:${store.epoch}:${source}`,
                  side: -1,
                  ignoreSelection: true,
                  destroy: (node) =>
                    (node as HTMLElement & { cancel?: () => void }).cancel?.(),
                },
              ),
            )
            return false
          })
          return DecorationSet.create(state.doc, widgets)
        },
      },
    })
  })
}
