import { reference } from './reference.mjs'

export function validate(required, pages) {
  const documented = new Map()
  const errors = []
  for (const [file, source] of pages) {
    try {
      const result = reference(source, file, required)
      errors.push(...result.errors)
      for (const entry of result.descriptions) {
        if (documented.has(entry.target))
          errors.push(
            `${entry.location}: duplicate primary description for ${entry.target}; already at ${documented.get(entry.target).location}`,
          )
        else documented.set(entry.target, entry)
      }
    } catch (error) {
      errors.push(`${file}: ${error.message}`)
    }
  }
  for (const target of required)
    if (!documented.has(target))
      errors.push(`Missing API description: ${target}`)
  return { errors, documented }
}
