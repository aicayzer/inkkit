import type { Node } from '@milkdown/kit/prose/model'
import { resolveFile, withFileSignal } from './files'
import { fileReference } from './linked-syntax'
import type {
  DocumentContext,
  FileAdapter,
  FilePresentation,
  FileReference,
  ImageAdapter,
  PortableImage,
} from './types'

export interface PortableFile {
  reference: FileReference
  presentation: FilePresentation
  label: string
  description: string
}

export async function portableFile(
  node: Node,
  adapter: FileAdapter | undefined,
  context: DocumentContext,
  signal: AbortSignal,
): Promise<PortableFile | undefined> {
  if (!adapter) return undefined
  const reference = fileReference(node)
  let presentation: FilePresentation
  try {
    presentation = await resolveFile(adapter, reference, { ...context, signal })
  } catch (error) {
    signal.throwIfAborted()
    presentation = {
      kind: 'error',
      message:
        error instanceof Error ? error.message : 'The file is unavailable.',
    }
  }
  const label =
    presentation.label || reference.label || reference.reference || 'File'
  const kind = presentation.kind
  const description =
    kind === 'missing' || kind === 'error'
      ? `[File: ${label} (${kind === 'missing' ? 'unavailable' : 'error'})]`
      : `[${kind === 'pdf' ? 'PDF' : kind[0]!.toUpperCase() + kind.slice(1)}: ${label}]`
  return { reference, presentation, label, description }
}

export async function portableFileImage(
  file: PortableFile,
  files: FileAdapter,
  legacy: ImageAdapter | undefined,
  context: DocumentContext,
  signal: AbortSignal,
): Promise<PortableImage> {
  signal.throwIfAborted()
  const image = files.exportImage
    ? await withFileSignal(
        files.exportImage(file.reference, { ...context, signal }),
        signal,
      )
    : file.reference.kind === 'path' && legacy
      ? await withFileSignal(
          legacy.exportImage(file.reference.reference, { ...context }),
          signal,
        )
      : undefined
  signal.throwIfAborted()
  if (!image) throw new Error('The image has no portable export adapter.')
  return image
}
