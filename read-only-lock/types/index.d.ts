export type LockReason = string

declare module 'claude-code' {
  interface PluginState {
    'read-only-lock': { isLocked: boolean; reason: LockReason | null }
  }
}
