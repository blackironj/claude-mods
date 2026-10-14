import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Run, Watch } from '../types'
import { mark, summarize, triggerDir } from './runs'

const PANE = 'ci'
const POLL_MS = 30_000
const GIVE_UP_MS = 10 * 60_000

const watch = atom({ plugin: 'deploy-watch', key: 'watch' } as const, null as Watch | null)

async function startWatch($: EngineInterface, dir: string): Promise<Watch | undefined> {
  const cwd = dir === '' ? await $.session.cwd() : dir
  const head = await $.process.run(['git', 'rev-parse', 'HEAD', '--abbrev-ref', 'HEAD'], { cwd })
  if (head.exitCode !== 0) return undefined
  const [sha = '', branch = ''] = head.stdout.trim().split('\n')
  const next: Watch = { dir: cwd, branch, sha, startedAt: await $.clock.now(), runs: [], isDone: false }
  await update($, watch, () => next)
  return next
}

async function poll($: EngineInterface) {
  const w = await read($, watch)
  if (w === null || w.isDone) return

  const listed = await $.process.run(
    ['gh', 'run', 'list', '--commit', w.sha, '--json', 'name,status,conclusion,url', '--limit', '20'],
    { cwd: w.dir },
  )
  if (listed.exitCode !== 0) return
  const runs = JSON.parse(listed.stdout) as Run[]
  const summary = summarize(runs)
  const isStale = runs.length === 0 && (await $.clock.now()) - w.startedAt > GIVE_UP_MS

  await update($, watch, cur => (cur === null || cur.sha !== w.sha ? cur : { ...cur, runs, isDone: summary.isDone || isStale }))
  if (summary.isDone || isStale) {
    const text = isStale ? `No CI runs appeared for ${w.branch} in 10 min` : `${summary.text} · ${w.branch}`
    $.ui.toast(text, { timeoutMs: 15_000 })
    await $.ui.notify(text, { title: 'CI' })
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: PANE, description: 'Show GitHub Actions runs for the watched commit (starts watching HEAD if nothing is)' })
    $.clock.every(POLL_MS, () => void poll($))
    return next(e)
  })

  on('command.run', { command: PANE }, async $ => {
    const w = await read($, watch)
    if (w === null || w.isDone) await startWatch($, '')
    await $.ui.open({ id: PANE, title: 'CI' })
    void poll($)
    return { text: 'CI pane opened.' }
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const ran = await next(e)
    const dir = triggerDir(e.command)
    if (dir === undefined || ran.deny !== undefined || ran.isError === true) return ran

    const w = await startWatch($, dir)
    if (w === undefined) return ran
    const note = `deploy-watch is now tracking GitHub Actions for ${w.branch}@${w.sha.slice(0, 7)} and will notify the user when the runs finish; do not poll CI with sleep loops. The user can open the /ci pane.`
    return { ...ran, context: [...(ran.context ?? []), note] }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const w = await read($, watch)
    if (w === null) return <Text dimColor>Nothing watched yet. Push a branch, or run /ci in a repo.</Text>

    const summary = summarize(w.runs)
    return (
      <Box flexDirection="column">
        <Text bold>
          {w.branch} @ {w.sha.slice(0, 7)}
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
