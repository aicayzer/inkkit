export const diagramRefusal =
  'HTML, styles, actions, resources and diagram configuration are disabled. The source is retained.'

// Annotation syntax in the positions the pinned grammars read it: class
// annotations on their own line, before a class name or after `class Name`, and
// the state diagram fork, join and choice markers after `state Name`.
const annotationName = String.raw`\w(?:[\w -]*\w)?`
const classAnnotation = new RegExp(
  String.raw`(?<=^[ \t]*(?:class[ \t]+[^\s<>"]+(?:\["[^"\n<>]*"\])?[ \t]+)?)<<(${annotationName})>>(?=[ \t{]|$)`,
  'gm',
)
const stateAnnotation =
  /(?<=^[ \t]*state[ \t]+[^\s<>"]+[ \t]+)<<(fork|join|choice)>>(?=[ \t]*$)/gim
export const stateBrackets = /^[ \t]*state[ \t].*\[\[(fork|join|choice)\]\]/gim

interface Annotations {
  names: string[]
  rest: string
}

// Separates the annotations that the renderer may read from the rest of the source,
// which must pass the HTML check. Whether each one became an annotation is
// checked in the parse result.
function annotations(source: string): Annotations {
  const header = /^\s*(?:%%[^\n]*\n\s*)*(classDiagram|stateDiagram)/.exec(
    source,
  )?.[1]
  const pattern =
    header === 'classDiagram'
      ? classAnnotation
      : header === 'stateDiagram'
        ? stateAnnotation
        : undefined
  if (!pattern) return { names: [], rest: source }
  const names: string[] = []
  const rest = source.replace(pattern, (_, name: string) => {
    names.push(header === 'stateDiagram' ? name.toLowerCase() : name)
    return ''
  })
  // The class lexer skips comments, so a comment after << would hide an
  // annotation name from the HTML check.
  if (header === 'classDiagram' && /<<\s*%%/.test(rest))
    throw new Error(diagramRefusal)
  return { names, rest }
}

export function validateDiagram(source: string): Annotations {
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
  const found = annotations(source)
  // Resource and configuration syntax is refused anywhere in the source, labels included.
  // Statements are checked separately, in the renderer's parse result. The `---`
  // check reads only its own line's indent: `^\s*---` refuses the same sources
  // but rescans every following blank line from each line start.
  if (
    /%%\{|^[^\S\n\r\u2028\u2029]*---|<\s*[a-z!/?]|&(?:#\w+|[a-z]+);|@\{|\$\$|(?:https?|data|file|javascript|vbscript|blob):|\/\/|url\s*\(|image-set\s*\(|cross-fade\s*\(|@import|\\/im.test(
      found.rest,
    )
  )
    throw new Error(diagramRefusal)
  return found
}
