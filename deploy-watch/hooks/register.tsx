import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Run, Watch } from '../types'
import { mark, newSince, summarize, trigger } from './runs'
import type { Trigger } from './runs'

const PANE = 'ci'
const POLL_MS = 30_000
const GIVE_UP_MS = 10 * 60_000
const MERGE_GIVE_UP_MS = 60 * 60_000
const RUN_FIELDS = 'name,status,conclusion,url,createdAt'

const watch = atom({ plugin: 'deploy-watch', key: 'watch' } as const, null as Watch | null)

type PrView = { state: string; baseRefName: string; mergeCommit: { oid: string } | null }

function repoArgs(repo: string | undefined): string[] {
  return repo === undefined ? [] : ['-R', repo]
}

/** What the toast and the pane name: the workflow, the PR still to merge, or the branch. */
function label(w: Watch): string {
  if (w.workflow !== undefined) return w.branch === '' ? w.workflow : `${w.workflow} on ${w.branch}`
  if (w.sha === '' && w.pr !== undefined) return `PR ${w.pr}`
  return w.branch
}

function noteFor(w: Watch): string {
  const target =
    w.workflow !== undefined ? `the next ${label(w)} run`
    : w.sha === '' ? `${label(w)}'s merge commit once it merges`
    : `${w.branch}@${w.sha.slice(0, 7)}`
  return (
    `deploy-watch is now tracking GitHub Actions for ${target}. When the runs finish it notifies the user ` +
    '(toast and system notification) and sends you the result as a new message that starts a turn. Do not watch ' +
    'or poll this CI yourself (no `gh run watch`, no sleep loops). If your next step depends on this CI, say so to ' +
    'the user and end your turn; continue when the result arrives. The user can open the /ci pane.'
  )
}

async function absDir($: EngineInterface, dir: string): Promise<string> {
  if (dir.startsWith('/')) return dir
  const cwd = await $.session.cwd()
  return dir === '' ? cwd : `${cwd}/${dir}`
}

async function headOf($: EngineInterface, cwd: string): Promise<{ sha: string; branch: string } | undefined> {
  const head = await $.process.run(['git', 'rev-parse', 'HEAD', '--abbrev-ref', 'HEAD'], { cwd })
  if (head.exitCode !== 0) return undefined
  const [sha = '', branch = ''] = head.stdout.trim().split('\n')
  return { sha, branch }
}

async function viewPr($: EngineInterface, dir: string, repo: string | undefined, pr: string): Promise<PrView | undefined> {
  const out = await $.process.run(['gh', 'pr', 'view', pr, ...repoArgs(repo), '--json', 'state,baseRefName,mergeCommit'], { cwd: dir })
  return out.exitCode === 0 ? (JSON.parse(out.stdout) as PrView) : undefined
}

/**
 * The watch a trigger starts. A merge is watched on the commit GitHub made on
 * the base branch, not the local HEAD, since that is where deploy workflows run;
 * `branchBefore` names the PR when `gh pr merge` was given none.
 */
async function watchFor($: EngineInterface, t: Trigger, branchBefore: string | undefined): Promise<Watch | undefined> {
  const dir = await absDir($, t.dir)
  const now = await $.clock.now()
  const base = { dir, ...(t.repo === undefined ? {} : { repo: t.repo }), startedAt: now, runs: [], isDone: false }

  if (t.kind === 'push' || t.kind === 'pr-create') {
    const head = await headOf($, dir)
    return head === undefined ? undefined : { ...base, ...head, since: now }
  }
  if (t.kind === 'workflow-run') return { ...base, branch: t.ref ?? '', sha: '', workflow: t.workflow, since: now }

  const pr = t.pr ?? branchBefore
  if (pr === undefined) return undefined
  const view = await viewPr($, dir, t.repo, pr)
  if (view?.state === 'MERGED' && view.mergeCommit !== null) return { ...base, branch: view.baseRefName, sha: view.mergeCommit.oid }
  return { ...base, branch: view?.baseRefName ?? '', sha: '', pr }
}

/** Tells the person (toast, system notification) and the model (a prompt that starts a turn once the session is idle). */
async function announce($: EngineInterface, text: string) {
  $.ui.toast(text, { timeoutMs: 15_000 })
  await $.ui.notify(text, { title: 'CI' })
  await $.prompt.submit({
    text:
      `deploy-watch: ${text}. Tell the user this result in one line, then continue any work that was waiting on ` +
      'this CI; if a run failed, look at why before going on.',
  })
}

/** A PR not merged yet: switch to its merge commit once merged, stop when closed or after an hour. */
async function pollMerge($: EngineInterface, w: Watch, pr: string, now: number) {
  const view = await viewPr($, w.dir, w.repo, pr)
  if (view === undefined) return
  if (view.state === 'MERGED' && view.mergeCommit !== null) {
    const sha = view.mergeCommit.oid
    await update($, watch, cur => (cur?.startedAt === w.startedAt ? { ...cur, sha, branch: view.baseRefName, startedAt: now } : cur))
    return
  }
  if (view.state !== 'CLOSED' && now - w.startedAt <= MERGE_GIVE_UP_MS) return
  await update($, watch, cur => (cur?.startedAt === w.startedAt ? { ...cur, isDone: true } : cur))
  await announce($, view.state === 'CLOSED' ? `PR ${pr} was closed without merging` : `PR ${pr} did not merge within 60 min`)
}

async function poll($: EngineInterface) {
  const w = await read($, watch)
  if (w === null || w.isDone) return
  const now = await $.clock.now()
  if (w.sha === '' && w.pr !== undefined) return pollMerge($, w, w.pr, now)

  const listed = await $.process.run(
    w.workflow !== undefined
      ? ['gh', 'run', 'list', '--workflow', w.workflow, ...(w.branch === '' ? [] : ['--branch', w.branch]), ...repoArgs(w.repo), '--json', RUN_FIELDS, '--limit', '5']
      : ['gh', 'run', 'list', '--commit', w.sha, ...repoArgs(w.repo), '--json', RUN_FIELDS, '--limit', '20'],
    { cwd: w.dir },
  )
  if (listed.exitCode !== 0) return
  const runs = newSince(JSON.parse(listed.stdout) as Run[], w.since)
  const summary = summarize(runs)
  const isStale = runs.length === 0 && now - w.startedAt > GIVE_UP_MS

  await update($, watch, cur => (cur?.startedAt === w.startedAt ? { ...cur, runs, isDone: summary.isDone || isStale } : cur))
  if (summary.isDone || isStale) await announce($, isStale ? `No CI runs appeared for ${label(w)} in 10 min` : `${summary.text} · ${label(w)}`)
}

async function branchIn($: EngineInterface, dir: string): Promise<string | undefined> {
  return (await headOf($, await absDir($, dir)))?.branch
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: PANE, description: 'Show GitHub Actions runs for the watched commit (starts watching HEAD if nothing is)' })
    $.clock.every(POLL_MS, () => void poll($))
    return next(e)
  })

  on('command.run', { command: PANE }, async $ => {
    const w = await read($, watch)
    if (w === null || w.isDone) {
      const fresh = await watchFor($, { kind: 'push', dir: '' }, undefined)
      if (fresh !== undefined) await update($, watch, () => fresh)
    }
    await $.ui.open({ id: PANE, title: 'CI' })
    void poll($)
    return { text: 'CI pane opened.' }
  }).catch($ => ({ text: `${$.plugin.name}: could not open the CI pane.` }))

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const t = trigger(e.command)
    const before = t?.kind === 'pr-merge' && t.pr === undefined ? await branchIn($, t.dir) : undefined
    const ran = await next(e)
    if (t === undefined || ran.deny !== undefined || ran.isError === true) return ran

    const w = await watchFor($, t, before)
    if (w === undefined) return ran
    await update($, watch, () => w)
    return { ...ran, context: [...(ran.context ?? []), noteFor(w)] }
  }).catch(($, e, next) => next(e)) // a watch that fails to start must not fail the command

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const w = await read($, watch)
    if (w === null) return <Text dimColor>Nothing watched yet. Push a branch, or run /ci in a repo.</Text>

    const summary = w.sha === '' && w.pr !== undefined ? { text: 'waiting for the PR to merge' } : summarize(w.runs)
    return (
      <Box flexDirection="column">
        <Text weight="bold">
          {label(w)}
          {w.sha === '' ? '' : ` @ ${w.sha.slice(0, 7)}`}
        </Text>
        <Text dimColor>{summary.text}</Text>
        {w.runs.map(run => (
          <Text color={mark(run) === '✗' ? 'red' : mark(run) === '✓' ? 'green' : undefined}>
            {mark(run)} {run.name}
          </Text>
        ))}
      </Box>
    )
  })
}
