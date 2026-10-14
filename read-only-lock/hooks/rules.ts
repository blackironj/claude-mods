import { option, positionals, program, segments } from './shell'

// Prompts that ask for investigation or a plan only. English is the base
// set; Korean phrases ride along so either language triggers the lock.
const LOCK_EN = [
  /\bread[- ]?only\b/,
  /\b(just|only)\s+(look|investigate|check|read|explore|review)\b/,
  /\b(look|investigate|check|explore|review)\s+(only|first)\b/,
  /\b(plan|propose)\s+(it\s+)?first\b/,
  /\b(don'?t|do not|without)\s+(chang|modify|modifying|edit|touch|fix|commit|proceed)\w*/,
  /\bno\s+(changes|edits)\b/,
]
const LOCK_KO = [
  /확인\s*(부터|만)|파악\s*(부터|만)|살펴\s*보기?만|보기만|계획\s*(부터|만)/,
  /(수정|변경|고치|건드리)\s*(하지|지)\s*마|(수정|변경)\s*없이|읽기\s*전용/,
]
// Prompts that explicitly ask for changes.
const UNLOCK_EN = [
  /\bgo ahead\b/,
  /\b(apply|implement|fix|commit|ship)\s+(it|this|that|them)\b/,
  /\bmake\s+the\s+changes?\b/,
  /\byou\s+can\s+(now\s+)?(edit|change|modify|proceed)\b/,
  /^\s*(proceed|do it|lgtm)\b/,
]
const UNLOCK_KO = [/(수정|고쳐|적용|반영|구현|커밋|머지|작업|진행|저장)\s*(해|하자|합시다|ㄱ)|해도\s*(돼|된다|됨)/]

const LOCK = [...LOCK_EN, ...LOCK_KO]
const UNLOCK = [...UNLOCK_EN, ...UNLOCK_KO]

export type PromptIntent = 'lock' | 'unlock' | 'none'

/** Lock wins when a prompt says both ("look first, don't commit yet"). */
export function intentOf(text: string): PromptIntent {
  const lower = text.toLowerCase()
  if (LOCK.some(re => re.test(lower))) return 'lock'
  if (UNLOCK.some(re => re.test(lower))) return 'unlock'
  return 'none'
}

const FILE_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])
const SCRATCH = /^\/tmp\//

const GIT_MUTATING = new Set([
  'add', 'commit', 'push', 'merge', 'rebase', 'reset', 'checkout', 'switch', 'cherry-pick',
  'revert', 'rm', 'mv', 'restore', 'clean', 'am', 'apply', 'pull',
])
const GH_MUTATING = /^(create|merge|close|edit|reopen|comment|review|delete|ready|lock|unlock|transfer|run|rerun|cancel|set|upload)$/
const KUBECTL_MUTATING = new Set(['apply', 'create', 'delete', 'edit', 'patch', 'replace', 'scale', 'drain', 'cordon', 'uncordon', 'taint', 'label', 'annotate', 'rollout', 'set', 'exec', 'cp'])
const PLAIN_MUTATING = new Set(['rm', 'mv', 'cp', 'mkdir', 'rmdir', 'touch', 'chmod', 'chown', 'ln', 'truncate', 'dd', 'tee', 'patch', 'install', 'helm', 'terraform'])
const PKG = new Set(['npm', 'pnpm', 'yarn', 'pip', 'uv', 'cargo', 'go', 'bun'])
const PKG_MUTATING = new Set(['install', 'i', 'add', 'remove', 'rm', 'uninstall', 'update', 'upgrade', 'sync', 'get', 'publish', 'init'])

function isMutatingCommand(ws: string[]): boolean {
  const [cmd, a, b] = ws
  if (cmd === undefined) return false
  if (PLAIN_MUTATING.has(cmd)) return true
  if (cmd === 'sed' && ws.some(w => /^-i/.test(w) || w === '--in-place')) return true
  if (cmd === 'git') {
    // branch/tag/stash/worktree list when bare or given `list`
    const [sub = '', arg] = positionals(ws, 1, ['-C', '-c'])
    if (['branch', 'tag'].includes(sub)) return arg !== undefined || ws.some(w => /^-[dDmMcCf]$|^--(delete|move|copy|force)$/.test(w))
    if (['stash', 'worktree'].includes(sub)) return arg !== undefined && !['list', 'show'].includes(arg)
    return GIT_MUTATING.has(sub)
  }
  if (cmd === 'gh' && a === 'api') {
    const method = option(ws, '-X', '--method')
    const hasFields = ['-f', '-F', '--field', '--raw-field', '--input'].some(f => ws.includes(f))
    return method !== undefined ? method.toUpperCase() !== 'GET' : hasFields
  }
  if (cmd === 'gh') return b !== undefined && GH_MUTATING.test(b)
  if (cmd === 'kubectl') return ws.slice(1).some(w => KUBECTL_MUTATING.has(w))
  if (PKG.has(cmd)) return a !== undefined && PKG_MUTATING.has(a)
  return false
}

/** Output redirection into a file (not /dev/null or /tmp, not fd duplication). */
function writesFile(text: string): boolean {
  return /(^|[^0-9&<>])>>?(?!>)\s*(?![\s&]|\/dev\/null|\/tmp\/)[^\s|;&>]+/.test(text.replace(/(["'])(?:\\.|(?!\1).)*\1/g, '""'))
}

/** Why a tool call breaks the read-only lock, or undefined when it doesn't. */
export function violation(tool: string, input: { command?: string; file_path?: string; notebook_path?: string }): string | undefined {
  if (FILE_TOOLS.has(tool)) {
    const path = input.file_path ?? input.notebook_path ?? ''
    return SCRATCH.test(path) ? undefined : `${tool} on ${path}`
  }
  if (tool === 'Bash' && input.command !== undefined) {
    for (const seg of segments(input.command)) {
      const ws = program(seg.words)
      if (isMutatingCommand(ws)) return `\`${seg.text.slice(0, 80)}\``
      if (writesFile(seg.text)) return `a file redirect in \`${seg.text.slice(0, 80)}\``
    }
  }
  return undefined
}
