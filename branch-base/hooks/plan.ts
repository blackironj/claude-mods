import { option, positionals, program, segments } from './shell'

/** A branch or PR creation in a Bash command that names no base. */
export type Site = {
  kind: 'branch' | 'pr'
  /** Offset and source text of the simple command in the full command. */
  start: number
  text: string
  /** The `git` words before the subcommand (`git -C dir`), for a fetch. */
  gitPrefix: string[]
  /** Directory the command runs in: `git -C`, an earlier `cd`, or undefined. */
  dir: string | undefined
}

const GIT_GLOBAL_VALUED = ['-C', '-c', '--git-dir', '--work-tree']

export function shQuote(w: string): string {
  return /^[\w@%+=:,./-]+$/.test(w) ? w : `'${w.replace(/'/g, `'\\''`)}'`
}

function gitSite(ws: string[]): Pick<Site, 'kind' | 'gitPrefix'> | undefined {
  let i = 1
  while (ws[i]?.startsWith('-')) i += GIT_GLOBAL_VALUED.includes(ws[i] ?? '') ? 2 : 1
  const sub = ws[i]
  const gitPrefix = ws.slice(0, i)
  const rest = ws.slice(i)

  if (sub === 'checkout') {
    const isNew = rest.includes('-b') || rest.includes('-B')
    if (!isNew || rest.includes('--orphan')) return undefined
    return positionals(rest, 1, []).length === 1 ? { kind: 'branch', gitPrefix } : undefined
  }
  if (sub === 'switch') {
    const isNew = ['-c', '-C', '--create', '--force-create'].some(f => rest.includes(f))
    if (!isNew || rest.includes('--orphan')) return undefined
    return positionals(rest, 1, []).length === 1 ? { kind: 'branch', gitPrefix } : undefined
  }
  if (sub === 'worktree' && rest[1] === 'add') {
    if (rest.includes('--detach') || rest.includes('--orphan')) return undefined
    // -b/-B take the new branch's name, which then counts as a positional
    const hasName = rest.includes('-b') || rest.includes('-B')
    return positionals(rest, 2, ['--reason']).length === (hasName ? 2 : 1) ? { kind: 'branch', gitPrefix } : undefined
  }
  return undefined
}

/** Every branch/PR creation in `command` that leaves its base implicit. */
export function findSites(command: string): Site[] {
  const sites: Site[] = []
  let cdDir: string | undefined

  for (const seg of segments(command)) {
    const ws = program(seg.words)
    if (ws[0] === 'cd' && ws[1] !== undefined) {
      cdDir = ws[1]
      continue
    }
    if (ws[0] === 'git') {
      const site = gitSite(ws)
      if (site) sites.push({ ...site, start: seg.start, text: seg.text, dir: option(site.gitPrefix, '-C') ?? cdDir })
    } else if (ws[0] === 'gh' && ws[1] === 'pr' && ws[2] === 'create') {
      // A PR for another repo (--repo) can't be checked against local refs
      const isImplicit = option(ws, '--base', '-B') === undefined && option(ws, '-R', '--repo') === undefined
      if (isImplicit) sites.push({ kind: 'pr', start: seg.start, text: seg.text, gitPrefix: ['git'], dir: cdDir })
    }
  }
  return sites
}

/** The command with each site rewritten onto `base` (a branch on origin). */
export function rewrite(command: string, sites: readonly Site[], baseOf: (site: Site) => string | undefined): string {
  let out = command
  for (const site of [...sites].sort((a, b) => b.start - a.start)) {
    const base = baseOf(site)
    if (base === undefined) continue
    const replaced =
      site.kind === 'pr'
        ? `${site.text} --base ${shQuote(base)}`
        : `${site.gitPrefix.map(shQuote).join(' ')} fetch origin ${shQuote(base)} --quiet && ${site.text} ${shQuote(`origin/${base}`)}`
    out = out.slice(0, site.start) + replaced + out.slice(site.start + site.text.length)
  }
  return out
}
