import { jsonrepair } from 'jsonrepair'

// Accept only inserted closing delimiters/commas outside strings, never new text or values.
export function parseModelJson(content, onRepair = () => {}) {
  try { return JSON.parse(content) } catch (originalError) {
    if (typeof content !== 'string' || content.length > 1000000) throw originalError
    const source = content.trim()
    if (!source.startsWith('{') || !source.endsWith('}')) throw originalError
    let repaired
    try { repaired = jsonrepair(source) } catch { throw originalError }
    let index = 0, quoted = false, escaped = false, inserted = 0
    for (const char of repaired) {
      if (char !== source[index]) {
        if (quoted || !/[\]},\s]/u.test(char) || ++inserted > 16) throw originalError
        continue
      }
      index++
      if (quoted) {
        if (escaped) escaped = false
        else if (char === '\\') escaped = true
        else if (char === '"') quoted = false
      } else if (char === '"') quoted = true
    }
    if (index !== source.length || !inserted) throw originalError
    const value = JSON.parse(repaired)
    onRepair()
    return value
  }
}
