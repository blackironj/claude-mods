import { option, positionals, program, segments } from './shell'

export type Policy = {
  /** Kube contexts whose mutations need confirmation (also helm --kube-context). */
  prodContexts: readonly string[]
  /** Refuse kubectl mutations that name no --context. */
  requireContext: boolean
}

export const DEFAULT_POLICY: Policy = { prodContexts: ['prod'], requireContext: true }

export type Verdict =
  | { kind: 'pass' }
  | { kind: 'confirm'; why: string }
  | { kind: 'handoff'; why: string }
  | { kind: 'deny'; why: string }

const KUBECTL_VALUED = [
  '--context', '-n', '--namespace', '--kubeconfig', '--cluster', '--user', '-s', '--server',
  '--token', '--as', '-c', '--container', '-o', '--output', '-f', '--filename', '-l', '--selector',
]
const KUBECTL_MUTATING = new Set([
  'apply', 'create', 'delete', 'edit', 'patch', 'replace', 'scale', 'autoscale', 'drain', 'cordon',
  'uncordon', 'taint', 'label', 'annotate', 'set', 'expose', 'run', 'exec', 'cp', 'debug',
])
const ROLLOUT_READS = new Set(['status', 'history'])
const HELM_MUTATING = new Set(['install', 'upgrade', 'uninstall', 'delete', 'rollback'])
const HELM_VALUED = ['--kube-context', '-n', '--namespace', '--kubeconfig', '--kube-apiserver', '--kube-as-user', '--kube-token', '--registry-config', '--repository-cache', '--repository-config', '--burst-limit', '--qps']
const IAM_WRITE = /^(create|put|attach|detach|delete|update|add|remove|tag|untag|set|upload|change|reset|enable|deactivate)-/

function kubectl(ws: string[], policy: Policy): Verdict {
  const [verb = '', sub = ''] = positionals(ws, 1, KUBECTL_VALUED)
  const isMutating = KUBECTL_MUTATING.has(verb) || (verb === 'rollout' && !ROLLOUT_READS.has(sub))
  if (!isMutating) return { kind: 'pass' }
  const context = option(ws, '--context')
  if (context === undefined) {
    return policy.requireContext
      ? { kind: 'deny', why: `kubectl ${verb} has no explicit --context; add --context=<context> as the first argument` }
      : { kind: 'pass' }
  }
  return policy.prodContexts.includes(context)
    ? { kind: 'confirm', why: `kubectl ${verb}${verb === 'rollout' ? ` ${sub}` : ''} on ${context}` }
    : { kind: 'pass' }
}

function helm(ws: string[], policy: Policy): Verdict {
  // Global flags may come before the subcommand: `helm --kube-context prod -n ns uninstall x`.
  const [sub = ''] = positionals(ws, 1, HELM_VALUED)
  if (!HELM_MUTATING.has(sub)) return { kind: 'pass' }
  const context = option(ws, '--kube-context')
  if (context !== undefined && policy.prodContexts.includes(context)) return { kind: 'confirm', why: `helm ${sub} on ${context}` }
  if (context === undefined) return { kind: 'confirm', why: `helm ${sub} without --kube-context (target cluster unknown)` }
  return { kind: 'pass' }
}

function aws(ws: string[]): Verdict {
  const [service, op] = positionals(ws, 1, ['--profile', '--region', '--output', '--query', '--endpoint-url'])
  return service === 'iam' && op !== undefined && IAM_WRITE.test(op) ? { kind: 'confirm', why: `aws iam ${op}` } : { kind: 'pass' }
}

const VAULT_VALUED = new Set([
  '--backend', '--prompt', '--keychain', '--secret-service-collection', '--pass-dir', '--pass-cmd',
  '--pass-prefix', '--file-dir', '-d', '--duration', '--region', '-t', '--mfa-token',
])

// `aws-vault exec <profile> -- <cmd>` runs non-interactively on a cached session, so the
// wrapped command is judged like any other; only an interactive shell or login is handed off.
function awsVault(ws: string[], policy: Policy): Verdict {
  if (ws[1] === 'login') return { kind: 'handoff', why: 'aws-vault login opens the AWS console in your browser' }
  if (ws[1] !== 'exec') return { kind: 'pass' }
  let i = 2
  for (let w = ws[i]; w !== undefined && w.startsWith('-') && w !== '--'; w = ws[i]) {
    if (w === '--help') return { kind: 'pass' }
    i += !w.includes('=') && VAULT_VALUED.has(w) ? 2 : 1
  }
  const rest = ws.slice(i + 1)
  const inner = rest[0] === '--' ? rest.slice(1) : rest
  return inner.length > 0
    ? judge(program(inner), policy)
    : { kind: 'handoff', why: 'aws-vault exec without a command opens an interactive shell' }
}

function judge(ws: string[], policy: Policy): Verdict {
  if (ws[0] === 'kubectl') return kubectl(ws, policy)
  if (ws[0] === 'helm') return helm(ws, policy)
  if (ws[0] === 'aws') return aws(ws)
  if (ws[0] === 'aws-vault') return awsVault(ws, policy)
  return { kind: 'pass' }
}

const RANK = { pass: 0, confirm: 1, handoff: 2, deny: 3 } as const

/** The strictest verdict over every simple command in a Bash command line. */
export function classify(command: string, policy: Policy = DEFAULT_POLICY): Verdict {
  let worst: Verdict = { kind: 'pass' }
  for (const seg of segments(command)) {
    const v = judge(program(seg.words), policy)
    if (RANK[v.kind] > RANK[worst.kind]) worst = v
  }
  return worst
}
