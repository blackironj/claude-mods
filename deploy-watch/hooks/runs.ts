import type { Run } from '../types'
import { option, program, segments } from './shell'

/**
 * The directory a CI-triggering command ran in (`git -C`, an earlier `cd`,
 * or '' for the session's), or undefined when it triggers no CI.
 */
export function triggerDir(command: string): string | undefined {
  let cdDir = ''
  for (const seg of segments(command)) {
    const ws = program(seg.words)
    if (ws[0] === 'cd' && ws[1] !== undefined) cdDir = ws[1]
    const isPush = ws[0] === 'git' && ws.includes('push')
    const isPr = ws[0] === 'gh' && ((ws[1] === 'pr' && ['create', 'merge'].includes(ws[2] ?? '')) || (ws[1] === 'workflow' && ws[2] === 'run'))
    if (isPush) return option(ws, '-C') ?? cdDir
    if (isPr) return cdDir
  }
  return undefined
}

export type Summary = { isDone: boolean; text: string }

export function summarize(runs: readonly Run[]): Summary {
  if (runs.length === 0) return { isDone: false, text: 'waiting for runs' }
  const running = runs.filter(r => r.status !== 'completed')
  if (running.length > 0) return { isDone: false, text: `${running.length}/${runs.length} running` }
  const failed = runs.filter(r => !['success', 'skipped', 'neutral'].includes(r.conclusion))
  return failed.length === 0
    ? { isDone: true, text: `CI passed (${runs.length} runs)` }
    : { isDone: true, text: `CI failed: ${failed.map(r => `${r.name} (${r.conclusion})`).join(', ')}` }
}

export function mark(run: Run): string {
  if (run.status !== 'completed') return '…'
  return ['success', 'skipped', 'neutral'].includes(run.conclusion) ? '✓' : '✗'
}
