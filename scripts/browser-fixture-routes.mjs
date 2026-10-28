import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export function fixtureRoutes(repository) {
  const entries = new Map([
    [`/@fs${resolve(repository, 'src/core.ts')}`, '/_test/core.js'],
    [`/@fs${resolve(repository, 'src/preserve.ts')}`, '/_test/preservation.js'],
    [
      `/@fs${resolve(repository, 'test/browser/diagram-probe.ts')}`,
      '/_test/diagrams.js',
    ],
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
  const reexport = (response, location) => {
    // Redirected module URLs can instantiate a second copy of the target class.
    response.writeHead(200, {
      'Content-Type': 'text/javascript',
      'Cache-Control': 'no-store',
    })
    response.end(`export * from ${JSON.stringify(location)};`)
  }
  return {
    name: 'browser-fixture-entries',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const path = requestPath(request)
        if (path === undefined) return refuse(response)
        for (const [source, entry] of entries) {
          if (path === entry)
            return reexport(
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
        if (entry) return reexport(response, entry)
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
