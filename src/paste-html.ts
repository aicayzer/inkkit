// Elements the HTML paste path hands to ProseMirror's parser. Anything else
// is kept as literal source, so a tag must be listed here or rewritten by
// `normalizeClipboardHTML` to avoid becoming a raw-HTML block.
const rich = new Set([
  'P',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'STRONG',
  'MARK',
  'B',
  'EM',
  'I',
  'S',
  'DEL',
  'STRIKE',
  'CODE',
  'PRE',
  'BLOCKQUOTE',
  'A',
  'BR',
  'HR',
  'UL',
  'OL',
  'LI',
  'TABLE',
  'THEAD',
  'TBODY',
  'TFOOT',
  'TR',
  'TH',
  'TD',
  'IMG',
  'SPAN',
  'SUP',
  'DIV',
  'FONT',
  'SECTION',
  'ARTICLE',
  'MAIN',
  'HEADER',
  'FOOTER',
])
// Document furniture and form inputs hold no content of their own. A
// template never keeps `head`, so it is not listed.
const dropped = new Set(['STYLE', 'META', 'LINK', 'TITLE', 'SOURCE', 'INPUT'])
// The dialect has no underline, subscript or similar marks, so these keep
// their children and lose only the wrapper.
const unwrapped = new Set([
  'U',
  'SUB',
  'SMALL',
  'TIME',
  'ABBR',
  'CITE',
  'DFN',
  'VAR',
  'INS',
  'BDI',
  'BDO',
  'LABEL',
])
const blockWrappers = new Set(['FIGURE', 'FIGCAPTION', 'DL', 'DD'])
const handled = new Set([
  ...dropped,
  ...unwrapped,
  ...blockWrappers,
  'DT',
  'PICTURE',
])

export function isRichElement(element: Element): boolean {
  return rich.has(element.tagName)
}

/** Whether normalisation enters the element, so its content may be rewritten. */
export function isRewrittenElement(element: Element): boolean {
  return rich.has(element.tagName) || handled.has(element.tagName)
}

// `white-space` and its longhand `white-space-collapse` keep source spaces with
// these keywords. `pre-line` and `preserve-breaks` collapse spaces, so they are
// collapsed here too.
const keepingWhitespace = new Set([
  'pre',
  'pre-wrap',
  'break-spaces',
  'preserve',
  'preserve-spaces',
])

/**
 * Whether the element's own inline style makes a browser keep the whitespace
 * of its content, as copied editor code does with `white-space: pre`. The
 * declarations are parsed, so case, spacing, comments, quoted text and
 * `!important` do not matter. Style sheets are not consulted.
 */
export function keepsWhitespace(element: Element): boolean {
  const style = element.getAttribute('style')
  if (!style) return false
  const winning = new Map<string, { value: string; important: boolean }>()
  for (const declaration of declarations(style)) {
    const colon = declaration.indexOf(':')
    if (colon < 0) continue
    const name = declaration.slice(0, colon).trim().toLowerCase()
    if (name !== 'white-space' && name !== 'white-space-collapse') continue
    let value = declaration.slice(colon + 1).trim()
    const important = /!\s*important$/i.test(value)
    if (important) value = value.replace(/!\s*important$/i, '')
    const earlier = winning.get(name)
    if (!earlier?.important || important)
      winning.set(name, { value: value.trim().toLowerCase(), important })
  }
  return [...winning.values()].some(({ value }) =>
    value.split(/\s+/).some((keyword) => keepingWhitespace.has(keyword)),
  )
}

// Splits a style attribute at the semicolons that end declarations, ignoring
// those inside comments, quoted strings and parentheses such as `url(...)`.
function declarations(style: string): string[] {
  const result: string[] = []
  let current = ''
  let quote = ''
  let depth = 0
  for (let index = 0; index < style.length; index++) {
    const character = style[index]!
    if (quote) {
      current += character
      if (character === '\\' && index + 1 < style.length)
        current += style[++index]
      else if (character === quote) quote = ''
    } else if (character === '/' && style[index + 1] === '*') {
      const end = style.indexOf('*/', index + 2)
      index = end < 0 ? style.length : end + 1
    } else if (character === '"' || character === "'") {
      quote = character
      current += character
    } else if (character === '(') {
      depth++
      current += character
    } else if (character === ')') {
      depth = Math.max(0, depth - 1)
      current += character
    } else if (character === ';' && depth === 0) {
      result.push(current)
      current = ''
    } else current += character
  }
  result.push(current)
  return result
}

/**
 * Rewrites common web-page elements to ones the importer already understands.
 * Elements that will stay literal source are not entered, so their content is
 * preserved exactly.
 */
export function normalizeClipboardHTML(root: Node): void {
  for (const node of [...root.childNodes]) {
    if (node.nodeType === Node.COMMENT_NODE) {
      // Windows and some native apps leave the CF_HTML fragment markers in.
      if (/^\s*(?:Start|End)Fragment\s*$/.test((node as Comment).data))
        node.parentNode?.removeChild(node)
      continue
    }
    if (node.nodeType !== Node.ELEMENT_NODE) continue
    const element = node as Element
    const tag = element.tagName
    if (!rich.has(tag) && !handled.has(tag)) continue
    if (dropped.has(tag)) {
      const parent = element.parentElement
      element.remove()
      if (parent) removeEmptyParagraph(parent)
    } else if (tag === 'PICTURE') {
      const image = element.querySelector('img')
      if (image) element.replaceWith(image)
      else element.remove()
    } else if (unwrapped.has(tag)) {
      normalizeClipboardHTML(element)
      element.replaceWith(...element.childNodes)
    } else if (tag === 'DT') {
      normalizeClipboardHTML(element)
      // Markdown has no definition lists. A bold term over its definition
      // keeps which text names the other.
      const term = element.ownerDocument.createElement('div')
      boldInto(term, [...element.childNodes])
      element.replaceWith(term)
    } else if (blockWrappers.has(tag)) {
      normalizeClipboardHTML(element)
      const block = element.ownerDocument.createElement('div')
      block.append(...element.childNodes)
      element.replaceWith(block)
    } else {
      if (tag === 'LI') markTask(element)
      normalizeClipboardHTML(element)
    }
  }
}

// A paragraph whose only content was a dropped element would otherwise import
// as a blank paragraph.
function removeEmptyParagraph(from: Element): void {
  let node: Element | null = from
  while (
    node &&
    ['SPAN', 'FONT', 'STRONG', 'B', 'EM', 'I'].includes(node.tagName)
  )
    node = node.parentElement
  if (
    node?.tagName === 'P' &&
    !node.textContent?.trim() &&
    !node.querySelector('img,br,hr')
  )
    node.remove()
}

const termBlocks = new Set(['P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6'])
const blocks = new Set([
  ...termBlocks,
  'BLOCKQUOTE',
  'PRE',
  'UL',
  'OL',
  'LI',
  'TABLE',
  'THEAD',
  'TBODY',
  'TFOOT',
  'TR',
  'TH',
  'TD',
  'SECTION',
  'ARTICLE',
  'MAIN',
  'HEADER',
  'FOOTER',
  'HR',
])

// Bolds the inline content of a term. Paragraphs, headings and divisions
// inside it each become one bold paragraph; other blocks are kept as they are.
function boldInto(target: Element, nodes: Node[]): void {
  const document = target.ownerDocument
  let run: Element | undefined
  const paragraph = (content: Node[]) => {
    if (!content.some((node) => node.textContent?.trim() || isImage(node)))
      return undefined
    const block = document.createElement('p')
    const strong = document.createElement('strong')
    strong.append(...content)
    block.append(strong)
    target.append(block)
    return strong
  }
  for (const node of nodes) {
    const element =
      node.nodeType === Node.ELEMENT_NODE ? (node as Element) : null
    if (element && blocks.has(element.tagName)) {
      run = undefined
      if (element.tagName === 'P' || /^H[1-6]$/.test(element.tagName))
        paragraph([...element.childNodes])
      else if (element.tagName === 'DIV')
        boldInto(target, [...element.childNodes])
      else target.append(element)
    } else if (run) run.append(node)
    else if (node.textContent?.trim() || isImage(node)) {
      run = paragraph([node])
    }
  }
}

function isImage(node: Node): boolean {
  return (
    node.nodeType === Node.ELEMENT_NODE &&
    ((node as Element).tagName === 'IMG' ||
      !!(node as Element).querySelector('img'))
  )
}

// GitHub, Notion and similar pages render a task as a checkbox leading its
// list item, optionally inside a paragraph or label.
function leadingCheckbox(item: Element): Element | undefined {
  let node: Element = item
  for (;;) {
    const first = [...node.childNodes].find(
      (child) =>
        child.nodeType !== Node.COMMENT_NODE &&
        !(child.nodeType === Node.TEXT_NODE && !child.textContent?.trim()),
    )
    if (first?.nodeType !== Node.ELEMENT_NODE) return undefined
    const element = first as Element
    if (element.tagName === 'INPUT')
      return element.getAttribute('type')?.toLowerCase() === 'checkbox'
        ? element
        : undefined
    if (!['P', 'LABEL', 'DIV', 'SPAN'].includes(element.tagName))
      return undefined
    node = element
  }
}

function markTask(item: Element): void {
  const checkbox = leadingCheckbox(item)
  if (!checkbox) return
  item.setAttribute('data-item-type', 'task')
  item.setAttribute('data-checked', String(checkbox.hasAttribute('checked')))
  checkbox.remove()
}

const inline = new Set([
  'STRONG',
  'MARK',
  'B',
  'EM',
  'I',
  'S',
  'DEL',
  'STRIKE',
  'A',
  'SPAN',
  'SUP',
  'FONT',
])
const space = /[ \t\r\n\f]+/g

/**
 * Collapses source whitespace the way a browser renders it: runs become one
 * space, and none remains at the edges of a block or beside a line break.
 * `pre`, `code`, elements that stay literal source and elements whose style
 * keeps whitespace are not entered.
 */
export function collapseClipboardWhitespace(root: Node): void {
  hoistEdgeSpace(root)
  let trailing: Text | undefined
  let start = true
  const trim = () => {
    if (!trailing) return
    trailing.data = trailing.data.slice(0, -1)
    if (!trailing.data) trailing.remove()
    trailing = undefined
  }
  const visit = (node: Node): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node as Text
      let data = text.data.replace(space, ' ')
      if ((start || trailing) && data.startsWith(' ')) data = data.slice(1)
      if (!data) return text.remove()
      text.data = data
      start = false
      trailing = data.endsWith(' ') ? text : undefined
      return
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return
    const element = node as Element
    const tag = element.tagName
    if (keepsWhitespace(element)) {
      // Treated like `code` inside a line and like `pre` as a block.
      if (inline.has(tag) || tag === 'CODE' || tag === 'IMG') {
        trailing = undefined
        start = false
      } else {
        trim()
        start = true
      }
    } else if (inline.has(tag)) {
      for (const child of [...element.childNodes]) visit(child)
    } else if (tag === 'BR') {
      trim()
      start = true
    } else if (tag === 'CODE' || tag === 'IMG') {
      trailing = undefined
      start = false
    } else {
      trim()
      start = true
      if (blocks.has(tag) && tag !== 'PRE' && tag !== 'HR')
        for (const child of [...element.childNodes]) visit(child)
      trim()
      start = true
    }
  }
  for (const child of [...root.childNodes]) visit(child)
  trim()
}

// Whitespace inside emphasis, links and similar wrappers cannot be written in
// Markdown, so it moves outside them.
function hoistEdgeSpace(node: Node): void {
  for (const child of [...node.childNodes]) {
    if (child.nodeType !== Node.ELEMENT_NODE) continue
    const element = child as Element
    if (keepsWhitespace(element)) continue
    if (inline.has(element.tagName)) {
      hoistEdgeSpace(element)
      const lead = edgeText(element, 'start')
      const leading = lead?.data.match(/^[ \t\r\n\f]+/)?.[0]
      if (lead && leading) {
        lead.data = lead.data.slice(leading.length)
        element.before(leading)
      }
      const tail = edgeText(element, 'end')
      const trailing = tail?.data.match(/[ \t\r\n\f]+$/)?.[0]
      if (tail && trailing) {
        tail.data = tail.data.slice(0, -trailing.length)
        element.after(trailing)
      }
    } else if (blocks.has(element.tagName) && element.tagName !== 'PRE')
      hoistEdgeSpace(element)
  }
}

function edgeText(element: Element, side: 'start' | 'end'): Text | undefined {
  let node = side === 'start' ? element.firstChild : element.lastChild
  while (node && node.nodeType === Node.ELEMENT_NODE) {
    if (
      !inline.has((node as Element).tagName) ||
      keepsWhitespace(node as Element)
    )
      return undefined
    node = side === 'start' ? node.firstChild : node.lastChild
  }
  return node?.nodeType === Node.TEXT_NODE ? (node as Text) : undefined
}
