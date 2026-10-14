import { registerMermaid } from './mermaid'

registerMermaid(async () => (await import('mermaid')).default)

export * from './core'
