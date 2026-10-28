import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export function fixtureRoutes(repository) {
  const entries = new Map([
    [`/@fs${resolve(repository, 'src/core.ts')}`, '/_test/core.js'],
    [`/@fs${resolve(repository, 'src/preserve.ts')}`, '/_test/preservation.js'],
  ])
  const requestPath = (request) => {
    try {
      return decodeURIComponent(request.url?.split('?')[0] ?? '')
    } catch {
      return undefined
    }
  }
  const refuse = (response) => {
    response.writeHead(404)
    response.end('Unknown browser fixture module')
  }
  const redirect = (response, location) => {
    response.writeHead(307, { Location: location, 'Cache-Control': 'no-store' })
    response.end()
  }
  return {
    name: 'browser-fixture-entries',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const path = requestPath(request)
        if (path === undefined) return refuse(response)
        for (const [source, entry] of entries) {
          if (path === entry)
            return redirect(
              response,
              `/@fs${pathToFileURL(source.slice('/@fs'.length)).pathname}`,
            )
        }
        next()
      })
    },
    configurePreviewServer(server) {
      server.middlewares.use((request, response, next) => {
        const path = requestPath(request)
        if (path === undefined) return refuse(response)
        const entry = entries.get(path)
        if (entry) return redirect(response, entry)
        // Never turn an unexpected source import into a filesystem read or HTML.
        if (
          path.startsWith('/@fs') ||
          (path.startsWith('/_test/') && ![...entries.values()].includes(path))
        ) {
          return refuse(response)
        }
        next()
      })
    },
  }
}
