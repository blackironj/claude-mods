import { expect, test } from 'claude-code/testing'

import { classify } from '../hooks/classify'

test('prod kubectl mutations need confirmation, reads and beta pass', () => {
  expect(classify('kubectl --context=prod apply -f deploy.yaml').kind).toBe('confirm')
  expect(classify('kubectl --context prod -n api rollout restart deploy/api').kind).toBe('confirm')
  expect(classify('kubectl --context=prod rollout status deploy/api').kind).toBe('pass')
  expect(classify('kubectl --context=prod get pods -n api').kind).toBe('pass')
  expect(classify('kubectl --context=beta apply -f x.yaml').kind).toBe('pass')
  expect(classify('cd infra && kubectl --context=prod delete pod api-0 | tee out').kind).toBe('confirm')
})

test('kubectl mutation without --context is denied', () => {
  expect(classify('kubectl apply -f x.yaml').kind).toBe('deny')
  expect(classify('kubectl get pods').kind).toBe('pass')
})

test('aws-vault exec is handed off, IAM writes need confirmation', () => {
  expect(classify('aws-vault exec prod -- aws iam list-roles').kind).toBe('handoff')
  expect(classify('aws --profile prod iam attach-role-policy --role-name r --policy-arn a').kind).toBe('confirm')
  expect(classify('aws iam get-role --role-name r').kind).toBe('pass')
  expect(classify('helm upgrade api ./chart --kube-context prod').kind).toBe('confirm')
})

test('prodContexts and requireContext come from the policy', () => {
  const policy = { prodContexts: ['prod-eu', 'prod-us'], requireContext: false }
  expect(classify('kubectl --context=prod-eu apply -f x.yaml', policy).kind).toBe('confirm')
  expect(classify('kubectl --context=prod apply -f x.yaml', policy).kind).toBe('pass')
  expect(classify('kubectl apply -f x.yaml', policy).kind).toBe('pass')
  expect(classify('helm upgrade api ./chart --kube-context prod-us', policy).kind).toBe('confirm')
})

test('quoted separators do not split commands', () => {
  expect(classify('echo "kubectl --context=prod apply; done"').kind).toBe('pass')
})

test('a prod mutation the user declines does not run', async ($, on) => {
  let ran = false
  on('tool.call', { tool: 'AskUserQuestion' }, () => ({ result: { answers: {} } }))
  on('tool.call', { tool: 'Bash' }, () => {
    ran = true
    return { result: { stdout: '', stderr: '', interrupted: false } }
  })
  const result = await $.tool.call({ tool: 'Bash', command: 'kubectl --context=prod delete pod x' })
  expect(result.deny).toBeDefined()
  expect(ran).toBe(false)
})
