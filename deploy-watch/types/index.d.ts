/** One `gh run list` row; `createdAt` is absent in state kept by 0.2.0 and earlier. */
export type Run = { name: string; status: string; conclusion: string; url: string; createdAt?: string }

export type Watch = {
  dir: string
  /** `-R/--repo` of the triggering command, passed on to every `gh` call. */
  repo?: string
  branch: string
  /** The watched commit; '' while waiting for `pr` to merge or for a dispatched `workflow`'s run. */
  sha: string
  /** A PR whose merge commit becomes `sha` once it merges (`gh pr merge --auto`). */
  pr?: string
  /** A dispatched workflow, watched by name instead of by commit. */
  workflow?: string
  startedAt: number
  /** Runs created before this (less a skew) belong to an earlier trigger; absent for a fresh merge commit. */
  since?: number
  runs: Run[]
  isDone: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'deploy-watch': { watch: Watch | null }
  }
}
