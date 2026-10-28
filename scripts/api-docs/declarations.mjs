import { resolve } from 'node:path'
import { API, SymbolFlags } from 'typescript/unstable/sync'
import { SyntaxKind } from 'typescript/unstable/ast'

/** Read the built contract, including aliases and both package entry points. */
export function declarations(root, config = 'scripts/api-docs/tsconfig.json') {
  const api = new API({ cwd: root })
  let snapshot
  try {
    const path = resolve(root, config)
    snapshot = api.updateSnapshot({ openProjects: [path] })
    const project = snapshot.getProject(path)
    if (!project) throw new Error(`Declaration project was not loaded: ${path}`)
    const diagnostics = project.program.getSyntacticDiagnostics()
    if (diagnostics.length)
      throw new Error(
        `Declaration syntax errors: ${JSON.stringify(diagnostics)}`,
      )
    const required = new Set()
    const entries = new Map()
    const addMembers = (owner, members) => {
      for (const member of members) {
        if (
          member.modifiers?.some((modifier) =>
            [SyntaxKind.PrivateKeyword, SyntaxKind.ProtectedKeyword].includes(
              modifier.kind,
            ),
          ) ||
          member.kind === SyntaxKind.Constructor
        )
          continue
        if (!member.name || member.name.kind !== SyntaxKind.Identifier)
          throw new Error(
            `Unsupported public member in ${owner}: ${member.getText()}`,
          )
        const name = `${owner}.${member.name.getText()}`
        required.add(name)
        if (member.type?.kind === SyntaxKind.TypeLiteral)
          addMembers(name, member.type.members)
      }
    }
    for (const entry of ['index', 'core']) {
      const source = project.program.getSourceFile(
        resolve(root, `dist/${entry}.d.ts`),
      )
      if (!source)
        throw new Error(`Missing built declaration: dist/${entry}.d.ts`)
      const module = project.checker.getSymbolAtLocation(source)
      if (!module) throw new Error(`Missing module symbol: ${entry}`)
      const exports = project.checker.getExportsOfModule(module)
      if (!exports.length) throw new Error(`Empty public entry: ${entry}`)
      entries.set(entry, exports.map((symbol) => symbol.name).sort())
      for (const exported of exports) {
        required.add(exported.name)
        const target =
          exported.flags & SymbolFlags.Alias
            ? project.checker.getAliasedSymbol(exported)
            : exported
        if (!target.declarations.length)
          throw new Error(`Missing declaration for ${exported.name}`)
        for (const handle of target.declarations) {
          const node = handle.resolve(project)
          if (!node) throw new Error(`Unresolved declaration: ${exported.name}`)
          if (
            [
              SyntaxKind.InterfaceDeclaration,
              SyntaxKind.ClassDeclaration,
            ].includes(node.kind)
          )
            addMembers(exported.name, node.members)
          else if (
            ![
              SyntaxKind.TypeAliasDeclaration,
              SyntaxKind.FunctionDeclaration,
              SyntaxKind.VariableDeclaration,
            ].includes(node.kind)
          )
            throw new Error(
              `Unsupported exported declaration: ${exported.name} (${SyntaxKind[node.kind]})`,
            )
        }
      }
    }
    return { required, entries }
  } finally {
    snapshot?.dispose()
    api.close()
  }
}
