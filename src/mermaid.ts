import mermaid from 'mermaid'
import DOMPurify from 'dompurify'
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import { Plugin, PluginKey } from '@milkdown/kit/prose/state'
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view'
import { $prose } from '@milkdown/kit/utils'
import { InkKitError, type PortableImage } from './types'

export function isMermaid(node: ProseNode): boolean {
  return node.type.name === 'code_block' && node.attrs.language === 'mermaid'
}

export function validateDiagram(source: string): void {
  if (source.length > 30000)
    throw new Error('The diagram exceeds the 30,000 character rendering limit.')
  if (
    !/^\s*(?:%%[^\n]*\n\s*)*(?:flowchart|graph|sequenceDiagram|classDiagram|stateDiagram(?:-v2)?|erDiagram|pie)\b/.test(
      source,
    )
  )
    throw new Error(
      'This diagram type is not supported. The source is retained.',
    )
  // Mermaid can load image bytes before sanitising its result. Reject resource
  // and configuration syntax before calling the renderer, including entities.
  if (
    /%%\{|^\s*---|<\s*[a-z!/?]|&(?:#\w+|[a-z]+);|@\{|\$\$|(?:https?|data|file|javascript|vbscript|blob):|\/\/|\b(?:click|callback|href|link|image|icon|fontawesome|style|classDef|linkStyle)\b|url\s*\(|@import|\\/im.test(
      source,
    )
  )
    throw new Error(
      'HTML, actions, resources and diagram configuration are disabled. The source is retained.',
    )
}

let sequence = 0
let queue: Promise<unknown> = Promise.resolve()
const cache = new Map<string, Promise<string>>()

export function safeDiagramSVG(svg: string): string {
  const clean = DOMPurify.sanitize(svg, {
    USE_PROFILES: { svg: true, svgFilters: true },
    FORBID_TAGS: ['foreignObject', 'image', 'a', 'script', 'animate', 'set'],
    FORBID_ATTR: ['href', 'xlink:href'],
  })
  const template = document.createElement('template')
  template.innerHTML = clean
  const root = template.content.querySelector('svg')
  if (!root) throw new Error('The renderer did not produce a diagram.')
  for (const element of [root, ...root.querySelectorAll('*')]) {
    for (const attribute of [...element.attributes]) {
      if (
        /^on/i.test(attribute.name) ||
        /(?:https?|data|file|javascript|blob):|@import|url\s*\(\s*[^#]|\\/i.test(
          attribute.value,
        )
      )
        element.removeAttribute(attribute.name)
    }
    if (
      element.tagName.toLowerCase() === 'style' &&
      /@import|(?:https?|data|file):|url\s*\(\s*[^#]|\\/i.test(
        element.textContent ?? '',
      )
    )
      element.remove()
  }
  root.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  return root.outerHTML
}

export function renderDiagram(source: string): Promise<string> {
  try {
    validateDiagram(source)
  } catch (error) {
    return Promise.reject(error)
  }
  const previous = cache.get(source)
  if (previous) return previous
  const rendered = queue.then(async () => {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      htmlLabels: false,
      suppressErrorRendering: true,
      fontFamily: 'Arial, sans-serif',
      altFontFamily: 'Arial, sans-serif',
      layout: 'dagre',
      look: 'classic',
      theme: 'default',
      maxTextSize: 30000,
      maxEdges: 500,
      flowchart: { htmlLabels: false },
      sequence: {
        actorFontFamily: 'Arial, sans-serif',
        noteFontFamily: 'Arial, sans-serif',
        messageFontFamily: 'Arial, sans-serif',
      },
      secure: [
        'securityLevel',
        'htmlLabels',
        'theme',
        'themeCSS',
        'themeVariables',
        'fontFamily',
        'dompurifyConfig',
        'flowchart',
        'startOnLoad',
        'maxTextSize',
        'maxEdges',
        'secure',
        'altFontFamily',
        'layout',
        'look',
        'sequence',
        'class',
        'state',
        'er',
        'pie',
        'suppressErrorRendering',
      ],
    })
    const holder = document.createElement('div')
    holder.style.cssText =
      'position:fixed;left:-100000px;top:0;width:1200px;pointer-events:none'
    holder.setAttribute('aria-hidden', 'true')
    document.body.append(holder)
    try {
      const result = await mermaid.render(
        `inkkitDiagram${++sequence}`,
        source,
        holder,
      )
      return safeDiagramSVG(result.svg)
    } finally {
      holder.remove()
    }
  })
  queue = rendered.catch(() => undefined)
  cache.set(source, rendered)
  void rendered.catch(() => {
    if (cache.get(source) === rendered) cache.delete(source)
  })
  if (cache.size > 64) cache.delete(cache.keys().next().value!)
  return rendered
}

export async function diagramImage(source: string): Promise<PortableImage> {
  const svg = await renderDiagram(source)
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

export function mermaidPreview(onError: (error: Error) => void) {
  return $prose(
    () =>
      new Plugin({
        key: new PluginKey('mermaidPreview'),
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
                    preview.textContent = 'Rendering diagram…'
                    let active = true
                    ;(preview as HTMLElement & { cancel?: () => void }).cancel =
                      () => {
                        active = false
                      }
                    void renderDiagram(source).then(
                      (svg) => {
                        if (active) {
                          preview.innerHTML = svg
                          preview.dataset.state = 'ready'
                        }
                      },
                      (error: unknown) => {
                        if (!active) return
                        const message =
                          error instanceof Error
                            ? error.message
                            : 'The diagram could not be rendered.'
                        preview.textContent = `Diagram unavailable: ${message}`
                        preview.dataset.state = 'error'
                        onError(new InkKitError('diagram-unavailable', message))
                      },
                    )
                    return preview
                  },
                  {
                    key: `mermaid:${source}`,
                    side: -1,
                    ignoreSelection: true,
                    destroy: (node) =>
                      (
                        node as HTMLElement & { cancel?: () => void }
                      ).cancel?.(),
                  },
                ),
              )
              return false
            })
            return DecorationSet.create(state.doc, widgets)
          },
        },
      }),
  )
}
