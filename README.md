# claude-mods

Five [Claude Code mods](https://code.claude.com/docs/en/plugins/mods) that guard risky actions and cut down on babysitting: confirm production changes, keep secrets out of the model's context, start branches from the right base, hold Claude to "just look" when you ask for it, and tell you when CI finishes.

They started as one person's setup and stay opinionated, but every personal value is a plugin option with a sensible default.

> [!WARNING]
> Mods run inside Claude Code with your permissions and are not sandboxed. These guards parse shell commands heuristically: they catch the common forms Claude writes, not every way a command can be spelled. Treat them as a safety net for mistakes, not a security boundary. Read the source before installing.

## Mods

| Mod | What it does |
| --- | --- |
| [`prod-guard`](prod-guard) | Holds mutating `kubectl`/`helm` commands against production contexts and `aws iam` writes until you confirm the exact command; a confirmed call skips the auto-mode classifier. Refuses mutating `kubectl` without an explicit `--context`. Puts `aws-vault exec` commands in your prompt box as `! …` instead of running them, since they need your interactive session. |
| [`secret-guard`](secret-guard) | Blocks Bash and Read access to `.env` files (not `.env.example`) and to `~/.claude.json`. Masks JWTs, AWS/GitHub/Slack/Anthropic/OpenAI/Google keys and private key blocks in Bash and Read output before Claude sees them. |
| [`branch-base`](branch-base) | Rewrites `git checkout -b`, `git switch -c` and `git worktree add` with no start point to start from `origin/<base>` after a fetch, and adds `--base <base>` to `gh pr create`. When a repo has no such branch, asks you which base to use (remembered per repo until reload). |
| [`read-only-lock`](read-only-lock) | After a look-only prompt ("just investigate", "plan first, don't change anything", or Korean equivalents such as "확인만 해"), blocks file edits and mutating commands and shows a one-line band with an **Unlock** button. "go ahead", "apply it" or the button unlocks. |
| [`deploy-watch`](deploy-watch) | After `git push`, `gh pr create` or `gh workflow run`, polls GitHub Actions for that commit every 30 s and raises a toast and a notification when the runs finish. Tells Claude not to poll CI with sleep loops. `/ci` opens a pane with the runs. |

## Install

Requires Claude Code v2.1.287 or later (mods are on by default). At the prompt of a terminal session:

```
/plugin install prod-guard --marketplace blackironj/claude-mods
```

Answer `y` to add the marketplace, then pick a scope (user scope loads it in every session). Repeat for each mod you want: `secret-guard`, `branch-base`, `read-only-lock`, `deploy-watch`.

From a shell:

```bash
claude plugin install prod-guard --marketplace blackironj/claude-mods
```

Disable or uninstall any mod from the **Installed** tab in `/plugin`.

## Options

Set them on the install screen, or change them later in `/config`.

| Mod | Option | Default | Meaning |
| --- | --- | --- | --- |
| `prod-guard` | `prodContexts` | `prod` | Comma-separated kube contexts whose mutations need confirmation (also matched against `helm --kube-context`). |
| `prod-guard` | `requireContext` | `true` | Refuse mutating `kubectl` commands without `--context`. |
| `branch-base` | `baseBranch` | `dev` | Remote branch new branches start from and PRs target. |

## Requirements and limits

- `deploy-watch` needs the [GitHub CLI](https://cli.github.com/) signed in; `branch-base` needs `git`.
- Panes, bands and toasts draw in the terminal and the Desktop app's Code tab. Under `claude -p` and the VS Code chat panel the guards still run but nothing is drawn.
- `read-only-lock` decides from keywords, so it can lock or stay unlocked when you didn't mean it to; the band shows when it is on.
- `secret-guard` also blocks commands that create a `.env` (for example `cp .env.example .env`); run those yourself. Masking covers the token shapes listed above, not arbitrary passwords.
- `branch-base` does not affect worktrees Claude Code creates on its own (`EnterWorktree`).
- `prod-guard` lets a call you confirmed run even where a permission rule or the auto-mode classifier would stop it, and its `aws-vault` handoff puts a command Claude wrote into your prompt box: a `!` command runs in your shell with no permission check, so read it before pressing Enter.

## Development

Each mod is a plugin folder (`.claude-plugin/plugin.json`, `hooks/hooks.json`, a TypeScript hooks module, tests). There is no build step: Claude Code loads the `.ts`/`.tsx` sources directly. See [CLAUDE.md](CLAUDE.md) for the layout, checks and conventions.

```bash
claude plugin validate prod-guard   # what the module hooks and calls, and anything the engine would refuse
claude plugin test prod-guard       # runs prod-guard/tests/*.test.ts against the engine
claude --plugin-dir ./prod-guard    # a session with your working copy loaded and hot-reloaded
```

## License

[MIT](LICENSE)
