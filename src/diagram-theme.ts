const namespace = '--_inkkit-diagram-'
const font = 'Arial, sans-serif'
let placement = 0

export type DiagramTheme = Readonly<Record<string, string>>

const colors: Record<string, string> = {
  bg: '#ffffff',
  fg: '#1c1c1e',
  muted: '#636366',
  line: '#48484a',
  surface: '#f2f2f7',
  'surface-alt': '#e5e5ea',
  border: '#8e8e93',
  accent: '#a6d5ff',
}
const series = [
  '#0088ff',
  '#34c759',
  '#6155f5',
  '#ff8d28',
  '#ff383c',
  '#00c8b3',
  '#ffcc00',
  '#00c0e8',
]

// Resolve the palette once per output snapshot. The light scheme evaluates
// host light-dark() colors for the white export card, even in a dark editor.
export function captureDiagramTheme(root?: HTMLElement): DiagramTheme {
  const doc = root?.ownerDocument ?? document
  const card = doc.createElement('div')
  card.className = 'inkkit-mermaid-preview'
  card.style.cssText =
    'position:fixed;left:0;top:0;width:0;height:0;overflow:hidden;' +
    'visibility:hidden;pointer-events:none;contain:strict;color-scheme:light'
  card.style.setProperty(namespace + 'bg', '#ffffff')
  card.style.setProperty(namespace + 'fg', '#1c1c1e')
  const fallback: Record<string, string> = { ...colors }
  for (const [index, color] of series.entries()) {
    fallback[`series-${index + 1}`] =
      `color-mix(in srgb, ${color} 35%, #ffffff)`
  }
  const probes = Object.entries(fallback).map(([key, value]) => {
    const probe = doc.createElement('span')
    probe.style.color = `var(${namespace}${key}, ${value})`
    card.append(probe)
    return [key, probe] as const
  })
  const host = root ?? doc.body
  host.append(card)
  try {
    const view = doc.defaultView!
    const theme: Record<string, string> = {
      [namespace + 'font']: font,
      [namespace + 'font-mono']: 'monospace',
    }
    for (const [key, probe] of probes)
      theme[namespace + key] = view.getComputedStyle(probe).color
    return theme
  } finally {
    card.remove()
  }
}

function privateVariables(value: string): string {
  return value.replace(/--pele-([a-z0-9-]+)/g, (_match, name: string) => {
    const index = /^series-(\d+)$/.exec(name)
    return (
      namespace + (index ? `series-${((Number(index[1]) - 1) % 8) + 1}` : name)
    )
  })
}

function resolveVariables(
  value: string,
  variables: Readonly<Record<string, string>>,
  depth = 0,
): string {
  if (depth > 20)
    throw new Error('The diagram theme contains a variable cycle.')
  let result = ''
  let cursor = 0
  for (;;) {
    const start = value.indexOf('var(', cursor)
    if (start === -1) return result + value.slice(cursor)
    result += value.slice(cursor, start)
    let level = 1
    let end = start + 4
    let comma = -1
    for (; end < value.length && level; end++) {
      if (value[end] === '(') level++
      if (value[end] === ')') level--
      if (value[end] === ',' && level === 1 && comma === -1) comma = end
    }
    if (level)
      throw new Error('The diagram theme contains an incomplete variable.')
    const name = value.slice(start + 4, comma < 0 ? end - 1 : comma).trim()
    const fallback = comma < 0 ? '' : value.slice(comma + 1, end - 1).trim()
    result += resolveVariables(
      variables[name] || fallback,
      variables,
      depth + 1,
    )
    cursor = end
  }
}

function rebaseIDs(svg: SVGSVGElement): void {
  const prefix = `inkkit-diagram-placement-${++placement}-`
  const ids = new Map<string, string>()
  for (const element of [svg, ...svg.querySelectorAll('[id]')]) {
    const id = element.getAttribute('id')
    if (!id) continue
    const replacement = prefix + ids.size
    ids.set(id, replacement)
    element.setAttribute('id', replacement)
  }
  const references = (value: string) =>
    value.replace(
      /url\(\s*(['"]?)#([^\s)'";]+)\1\s*\)/g,
      (original, _quote: string, id: string) =>
        ids.has(id) ? `url(#${ids.get(id)})` : original,
    )
  for (const element of [svg, ...svg.querySelectorAll('*')]) {
    for (const attribute of [...element.attributes]) {
      if (attribute.name === 'id') continue
      let value = references(attribute.value)
      if (/^(?:href|xlink:href)$/.test(attribute.name) && value.startsWith('#'))
        value = '#' + (ids.get(value.slice(1)) ?? value.slice(1))
      if (/^aria-(?:labelledby|describedby)$/.test(attribute.name))
        value = value
          .split(/\s+/)
          .map((id) => ids.get(id) ?? id)
          .join(' ')
      element.setAttribute(attribute.name, value)
    }
    if (element.tagName.toLowerCase() === 'style') {
      let text = references(element.textContent ?? '')
      for (const [id, replacement] of ids) {
        const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        text = text.replace(
          new RegExp(`#${escaped}(?![\\w-])`, 'g'),
          '#' + replacement,
        )
      }
      element.textContent = text
    }
  }
}

/** Apply presentation to cached geometry without running the layout again. */
export function themedDiagram(
  source: string,
  root?: HTMLElement,
  portable = false,
  capturedTheme?: DiagramTheme,
): string {
  const doc = root?.ownerDocument ?? document
  const template = doc.createElement('template')
  template.innerHTML = source
  const svg = template.content.querySelector('svg')
  if (!svg) throw new Error('The renderer did not produce a diagram.')
  rebaseIDs(svg)
  for (const element of [svg, ...svg.querySelectorAll('*')]) {
    for (const attribute of [...element.attributes])
      element.setAttribute(attribute.name, privateVariables(attribute.value))
    if (element.tagName.toLowerCase() === 'style')
      element.textContent = privateVariables(element.textContent ?? '')
  }
  // A neutral halo keeps percentage labels readable over arbitrary host colors
  // and updates through CSS with the preview's light or dark background.
  for (const label of svg.querySelectorAll('.pele-slice-labels text')) {
    label.setAttribute('fill', `var(${namespace}fg, #1c1c1e)`)
    label.setAttribute('stroke', `var(${namespace}bg, #ffffff)`)
    label.setAttribute('stroke-width', '3')
    label.setAttribute('stroke-linejoin', 'round')
    label.setAttribute('paint-order', 'stroke')
  }
  if (portable) {
    const variables: Record<string, string> = {
      ...(capturedTheme ?? captureDiagramTheme(root)),
    }
    for (const name of Array.from(svg.style))
      if (name.startsWith('--'))
        variables[name] = svg.style.getPropertyValue(name)
    for (const element of [svg, ...svg.querySelectorAll('*')]) {
      for (const attribute of [...element.attributes])
        element.setAttribute(
          attribute.name,
          resolveVariables(attribute.value, variables),
        )
      if (element.tagName.toLowerCase() === 'style')
        element.textContent = resolveVariables(
          element.textContent ?? '',
          variables,
        )
      if ('style' in element) {
        const style = (element as SVGElement).style
        for (const name of Array.from(style))
          if (name.startsWith('--')) style.removeProperty(name)
      }
    }
    svg.style.fontFamily = font
    svg.style.background = '#ffffff'
  }
  return svg.outerHTML
}
