export type Run = { name: string; status: string; conclusion: string; url: string }

export type Watch = {
  dir: string
  branch: string
  sha: string
  startedAt: number
  runs: Run[]
  isDone: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'deploy-watch': { watch: Watch | null }
  }
}
