# claude-mods

Claude Code mods (plugins whose hooks run inside Claude Code) published as one marketplace, `blackironj-mods`. The mod API is early access and changes between releases: the type declarations of the running build are the authority, not memory of an older one.

## Layout

```
.claude-plugin/marketplace.json   marketplace listing every mod (source: ./<mod>)
<mod>/
  .claude-plugin/plugin.json      manifest; userConfig declares the mod's options
  hooks/hooks.json                { "modules": ["./register.ts"] } (or .tsx)
  hooks/register.ts(x)            the hooks module: export const register: Register
  hooks/*.ts                      pure helpers (parsing, classification) the tests import
  types/index.d.ts                $.state contract, only for mods that keep state
  tests/*.test.ts                 run by `claude plugin test <mod>`
  tsconfig.json                   extends .claude-plugin/types/tsconfig.json (engine-written, gitignored)
```

`hooks/shell.ts` (command splitting, option and positional parsing) is copied identically into prod-guard, branch-base, read-only-lock and deploy-watch, because a mod can only import files inside its own plugin folder. Change it in one place, copy it to the others, and test all four.

## Checks

Run for every mod you touch, and read the output:

```bash
claude plugin validate <mod>   # must pass; also lists hooks, calls, state reads/writes
claude plugin test <mod>       # all tests must pass
```

Type-check with `tsc -p <mod>` once the engine has laid `.claude-plugin/types/` (load the mod once with `claude --plugin-dir ./<mod>`). Without those types, use the tsconfig in the header of the build's `claude-code.d.ts` from a folder outside the mod.

## Conventions

- Guards fail closed: every gating `tool.call` hook has `.catch(($, e, next) => next.called ? next(e) : { deny: '...' })`, and judges before it calls `next`.
- Deny messages start with `<mod>:` and tell the model what to do instead.
- A helper that receives `$` must be a top-level function in the module file; the validator refuses `$` passed to a closure.
- Keep classification logic in pure functions in `hooks/*.ts` and test them directly; test hook behaviour through `$.tool.call` / `$.prompt.submit` with the test kit's `on` standing in for the engine.
- No status-line entries and no panes opened unasked: screen space is the user's. Use toasts, a band only while a state is active, or a pane behind a command.
- Personal values are `userConfig` options whose defaults are the author's setup; never hard-code a context name, branch or path.
- Trigger phrases are English first, with Korean equivalents alongside.
- Token-shaped test fixtures are assembled at run time (`'AK' + 'IA' + ...`) so scanners don't flag the repo.
- Bump a mod's `version` in `plugin.json` when its behaviour changes.

## Installed copy

The author installs from this working copy as a local folder marketplace, which reads the folder directly: after an edit, `/reload-plugins` in a session picks it up, no reinstall.
