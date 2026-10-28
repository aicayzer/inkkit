export function leadingBOMLength(text: string): 0 | 1 {
  return text.startsWith('\uFEFF') ? 1 : 0
}

export function withoutLeadingBOM(text: string): string {
  return text.slice(leadingBOMLength(text))
}
