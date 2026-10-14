// Minimal shell splitting for guards: good enough to find simple commands
// in a Bash tool call, not a full shell parser. Quotes are respected;
// substitutions ($(...), backticks) are not expanded.

export type Segment = {
  /** The segment's source text, trimmed. */
  text: string
  /** Offset of `text` in the full command. */
  start: number
  /** Words with quotes removed. */
  words: string[]
}

/** Splits a command line at unquoted `&&`, `||`, `;`, `|`, `&` and newlines. */
export function segments(command: string): Segment[] {
  const out: Segment[] = []
  let segStart = 0
  let quote: '"' | "'" | null = null

  const push = (end: number) => {
    const raw = command.slice(segStart, end)
    const lead = raw.length - raw.trimStart().length
    const text = raw.trim()
    if (text !== '') out.push({ text, start: segStart + lead, words: words(text) })
  }

  for (let i = 0; i < command.length; i++) {
    const c = command.charAt(i)
    if (quote !== null) {
      if (c === '\\' && quote === '"') i++
      else if (c === quote) quote = null
      continue
    }
    if (c === '\\') {
      i++
      continue
    }
    if (c === '"' || c === "'") {
      quote = c
      continue
    }
    const two = command.slice(i, i + 2)
    if (two === '&&' || two === '||') {
      push(i)
      segStart = i + 2
      i++
    } else if (c === '&' && /[<>]/.test(command.charAt(i - 1) + command.charAt(i + 1))) {
      // fd duplication or `&>`, not a separator
      continue
    } else if (c === ';' || c === '|' || c === '&' || c === '\n') {
      push(i)
      segStart = i + 1
    }
  }
  push(command.length)
  return out
}

/** Splits one simple command into words, removing quotes. */
export function words(text: string): string[] {
  const out: string[] = []
  let cur = ''
  let has = false
  let quote: '"' | "'" | null = null

  for (let i = 0; i < text.length; i++) {
    const c = text.charAt(i)
    if (quote !== null) {
      if (c === quote) quote = null
      else if (c === '\\' && quote === '"' && i + 1 < text.length) cur += text.charAt(++i)
      else cur += c
      continue
    }
    if (c === '"' || c === "'") {
      quote = c
      has = true
    } else if (c === '\\' && i + 1 < text.length) {
      cur += text.charAt(++i)
      has = true
    } else if (/\s/.test(c)) {
      if (has) out.push(cur)
      cur = ''
      has = false
    } else {
      cur += c
      has = true
    }
  }
  if (has) out.push(cur)
  return out
}

const WRAPPERS = new Set(['sudo', 'env', 'time', 'command', 'exec'])

/** Drops leading `VAR=value` assignments and `sudo`/`env`/`time` wrappers. */
export function program(ws: string[]): string[] {
  const i = ws.findIndex(w => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(w) && !WRAPPERS.has(w))
  return i === -1 ? [] : ws.slice(i)
}

/**
 * The value of a long or short option in `ws`, written `--name=value` or
 * `--name value`; undefined when absent.
 */
export function option(ws: string[], ...names: string[]): string | undefined {
  for (const [i, w] of ws.entries()) {
    for (const name of names) {
      if (w === name) return ws[i + 1]
      if (name.startsWith('--') && w.startsWith(name + '=')) return w.slice(name.length + 1)
    }
  }
  return undefined
}

/**
 * Positional words after `from`, skipping flags and redirections; flags in
 * `valued` consume the next word unless written `--flag=value`.
 */
export function positionals(ws: string[], from: number, valued: readonly string[]): string[] {
  const out: string[] = []
  let skip = false
  for (const [i, w] of ws.entries()) {
    if (i < from) continue
    if (skip) {
      skip = false
      continue
    }
    if (w === '--') {
      out.push(...ws.slice(i + 1))
      break
    }
    if (/^\d*(>>?|<|&>)/.test(w)) {
      skip = /^\d*(>>?|<|&>)$/.test(w)
      continue
    }
    if (w.startsWith('-') && w !== '-') {
      skip = !w.includes('=') && valued.includes(w)
      continue
    }
    out.push(w)
  }
  return out
}
