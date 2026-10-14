import type { EngineInterface, Register } from 'claude-code'

import { findSites, rewrite, type Site } from './plan'

const KEEP = 'Keep as typed'
const CANCEL = 'Cancel'

type Base = { branch: string } | { keep: true } | { cancel: true }

// Answers for repos without the preferred base, per repo, until the module reloads.
const chosen = new Map<string, Base>()

async function git($: EngineInterface, dir: string | undefined, ...args: string[]) {
  const cwd = dir?.startsWith('~') ? `${(await $.env.get('HOME')) ?? ''}${dir.slice(1)}` : dir
  return $.process.run(['git', ...args], cwd === undefined ? {} : { cwd })
}

async function hasRemoteBranch($: EngineInterface, dir: string | undefined, branch: string) {
  return (await git($, dir, 'rev-parse', '--verify', '--quiet', `refs/remotes/origin/${branch}`)).exitCode === 0
}

async function baseFor($: EngineInterface, dir: string | undefined, preferred: string): Promise<Base> {
  const common = await git($, dir, 'rev-parse', '--path-format=absolute', '--git-common-dir')
  if (common.exitCode !== 0) return { keep: true }
  const repo = common.stdout.trim()

  if (await hasRemoteBranch($, dir, preferred)) return { branch: preferred }
  const known = chosen.get(repo)
  if (known) return known

  const candidates: string[] = []
  for (const b of ['main', 'master']) if (b !== preferred && (await hasRemoteBranch($, dir, b))) candidates.push(b)
  const answer = await $.ui.ask(
    `${repo.replace(/\/\.git$/, '')} has no origin/${preferred}. Which branch should new branches and PRs start from?`,
    { header: 'branch base', options: [...candidates, KEEP, CANCEL] },
  )
  const base: Base = answer === CANCEL ? { cancel: true } : answer === KEEP ? { keep: true } : { branch: answer.trim() }
  if (!('cancel' in base)) chosen.set(repo, base)
  return base
}

export const register: Register = (on, options) => {
  const preferred = String(options.baseBranch ?? 'dev').trim() || 'dev'
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const sites = findSites(e.command)
    if (sites.length === 0) return next(e)

    const bases = new Map<Site, string>()
    for (const site of sites) {
      const base = await baseFor($, site.dir, preferred)
      if ('cancel' in base) return { deny: 'branch-base: the user cancelled; ask which base branch to use.' }
      if ('branch' in base) bases.set(site, base.branch)
    }
    if (bases.size === 0) return next(e)

    const command = rewrite(e.command, sites, site => bases.get(site))
    const ran = await next({ ...e, command })
    if (ran.deny !== undefined) return ran
    const note = `branch-base rewrote the command to start from ${[...new Set(bases.values())].map(b => `origin/${b}`).join(', ')}: ${command}`
    return { ...ran, context: [...(ran.context ?? []), note] }
  }).catch(($, e, next) => (next.called ? next(e) : { deny: 'branch-base: could not decide the base branch; the command did not run.' }))
}
