import { registerDiagram } from './mermaid'
import { renderPele } from './pele'

registerDiagram(renderPele)

export * from './core'
