# API reference validation

Run `pnpm build` before `pnpm test:docs`. The latter runs the validator's negative checks and then checks every reference page against the built package. Keep descriptions beside the API they describe; a name in an example or another member's explanation does not document it.

## Declaration coverage

The checker reads both package entry points through the installed TypeScript native API. It follows re-exports and aliases and checks each exported name. For exported interfaces and classes, it checks direct public fields, methods and accessors, including static methods. Overloads share one description. Private and protected members and constructors are excluded; class overview prose must explain construction where applicable.

Inline object properties are checked recursively, such as `EditorOptions.rendering.diagramPreview`. Named types have their own descriptions: `EditorOptions.textInput` does not duplicate the fields of `TextInputPreferences`. Inherited fields are described on their declaring type, so `DocumentVersion` is documented once. Type aliases, including unions and mapped types, need an overview; the checker does not evaluate their possible values or inspect callback parameters and return-object fields. The command, shortcut and error-code tables still require review against their declarations.

The declaration reader uses `typescript/unstable/sync` and `typescript/unstable/ast`, from the version resolved by the lockfile. These are version-specific tooling APIs. Missing entries, unresolved declarations, syntax errors and unsupported public member shapes fail the check; there is no text-matching fallback. Compiler updates must pass the extraction fixtures as well as the actual reference check.

## Owned descriptions

An exact exported-type heading, such as `## ImageAdapter`, owns the following section. The section ends at the next heading of equal or shallower depth. For another heading, add an adjacent MDX comment:

```mdx
{/* @api EditorOptions */}

## Editor options

Options configure one mounted editor.

<ResponseField name="editable" type="boolean" default="true">
  Whether the person can edit. Selection and copying remain available when
  false.
</ResponseField>
```

The heading's direct prose describes the type, and each `ResponseField` describes a field on that type. Nested `Expandable` components whose titles are exported types switch to that type, such as `TextInputPreferences`. An anonymous object, such as `rendering`, keeps the surrounding field's qualified owner.

Use fully qualified names for editor methods. A shared section can describe two related members explicitly:

```mdx
{/* @api InkKitEditor.undo InkKitEditor.redo */}

### undo and redo
```

An `@api` annotation can also attach to one explanatory paragraph or list when a type is described alongside a method. It cannot attach to a code example or an ordinary comment. It does not claim unrelated prose elsewhere in the page. Duplicate primary descriptions and unknown identities fail the check; use ordinary links for additional references.

Use `@api-scope` to supply an owner without claiming an overview description. It applies to the next heading section, `ResponseField`, `Expandable` or field table:

```mdx
{/* @api-scope ViewportOptions */}

| Field             | Type                      | Meaning                                                   |
| ----------------- | ------------------------- | --------------------------------------------------------- |
| `scrollContainer` | `HTMLElement`             | The editor root or an ancestor that scrolls.              |
| `insets`          | `Partial<ViewportInsets>` | Covered distances by edge; omitted edges default to zero. |
```

A field table's first column lists exact code-span field names, with commas for genuinely shared descriptions. Its explanatory column must be named `Meaning`, `Description`, `Where it appears` or `true when`. Types and defaults do not supply the description. A label mentioned in another row cannot replace its own row.

## What the check establishes

The checker parses Markdown and MDX structure without executing MDX. Front matter, examples, signatures, links by themselves and child-field descriptions do not satisfy a description. Each description needs at least three words of explanatory prose, with placeholders rejected. Inline code can accompany that prose but does not count as prose by itself.

This establishes ownership and a minimum amount of explanation, not semantic accuracy. Review still checks behaviour, signatures, optional fields, defaults, return values, error conditions and examples. A long but incorrect sentence can pass, just as a type-correct implementation can still be wrong.

The negative fixtures cover ownership boundaries, same-named fields, empty descriptions, nested objects, literal JSX attributes, grouped table fields, aliases, visibility, malformed declarations and annotations. Mutation checks remove a real method section, option and label while retaining their incidental mentions, and require each qualified identity to remain missing.
