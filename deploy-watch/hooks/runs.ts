import type { Run } from '../types'
import { option, positionals, program, segments } from './shell'

/**
 * A CI-triggering command: where it ran (`git -C`, an earlier `cd`, or '' for
 * the session's directory), its `-R/--repo`, and what to watch afterwards.
 */
export type Trigger =
  | { kind: 'push'; dir: string; repo?: string }
  | { kind: 'pr-create'; dir: string; repo?: string }
  /** `pr` is the number, URL or branch given; absent means the current branch's PR. */
  | { kind: 'pr-merge'; dir: string; repo?: string; pr?: string }
  | { kind: 'workflow-run'; dir: string; repo?: string; workflow: string; ref?: string }

const PR_MERGE_VALUED = ['-b', '--body', '-F', '--body-file', '-t', '--subject', '-A', '--author-email', '--match-head-commit', '-R', '--repo']
const WORKFLOW_RUN_VALUED = ['-r', '--ref', '-f', '--raw-field', '-F', '--field', '-R', '--repo']

/** The first CI-triggering command in `command`, or undefined when it triggers no CI. */
export function trigger(command: string): Trigger | undefined {
  let cdDir = ''
  for (const seg of segments(command)) {
    const ws = program(seg.words)
    if (ws[0] === 'cd' && ws[1] !== undefined) cdDir = ws[1]
    if (ws[0] === 'git' && ws.includes('push')) return { kind: 'push', dir: option(ws, '-C') ?? cdDir }
    if (ws[0] !== 'gh') continue

    const repo = option(ws, '-R', '--repo')
    const at = (t: Trigger): Trigger => (repo === undefined ? t : { ...t, repo })
    if (ws[1] === 'pr' && ws[2] === 'create') return at({ kind: 'pr-create', dir: cdDir })
    if (ws[1] === 'pr' && ws[2] === 'merge') {
      const pr = positionals(ws, 3, PR_MERGE_VALUED)[0]
      return at(pr === undefined ? { kind: 'pr-merge', dir: cdDir } : { kind: 'pr-merge', dir: cdDir, pr })
    }
    if (ws[1] === 'workflow' && ws[2] === 'run') {
      const workflow = positionals(ws, 3, WORKFLOW_RUN_VALUED)[0]
      if (workflow === undefined) return undefined
      const ref = option(ws, '-r', '--ref')
      return at(ref === undefined ? { kind: 'workflow-run', dir: cdDir, workflow } : { kind: 'workflow-run', dir: cdDir, workflow, ref })
    }
  }
  return undefined
}

/** How far before a watch starts a run may be created and still belong to it (GitHub clock skew, push latency). */
export const SKEW_MS = 2 * 60_000

/**
 * The runs created after `since` (less `SKEW_MS`): a commit can already carry
 * runs from an earlier push or PR, which must not finish this watch early.
 * Runs without `createdAt` (state from an older version) are kept.
 */
export function newSince(runs: readonly Run[], since: number | undefined): Run[] {
  if (since === undefined) return [...runs]
  return runs.filter(r => r.createdAt === undefined || Date.parse(r.createdAt) >= since - SKEW_MS)
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
