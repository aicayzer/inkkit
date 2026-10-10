import { createPlayground, type Playground } from './controller'
import { mountUI } from './ui'
import '../src/style.css'
import './style.css'

const { api, initialise } = createPlayground(
  document.getElementById('editor')!,
  document.getElementById('second-editor')!,
)
export const playground = api
window.inkkitPlayground = api
mountUI(api)
await initialise()

declare global {
  interface Window {
    inkkitPlayground: Playground
  }
}
