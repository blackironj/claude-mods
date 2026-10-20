# claude-mods

Six [Claude Code mods](https://code.claude.com/docs/en/plugins/mods) that guard risky actions and cut down on babysitting: confirm production changes, keep secrets out of the model's context, start branches from the right base, hold Claude to "just look" when you ask for it, tell you when CI finishes, and let you approve a command auto mode blocked with one button.

They started as one person's setup and stay opinionated, but every personal value is a plugin option with a sensible default.

> [!WARNING]
> Mods run inside Claude Code with your permissions and are not sandboxed. These guards parse shell commands heuristically: they catch the common forms Claude writes, not every way a command can be spelled. Treat them as a safety net for mistakes, not a security boundary. Read the source before installing.

## Mods

| Mod | What it does |
| --- | --- |
| [`prod-guard`](prod-guard) | Holds mutating `kubectl`/`helm` commands against production contexts and `aws iam` writes until you confirm the exact command; a confirmed call skips the auto-mode classifier, and one the classifier blocks anyway goes into your prompt box as `! …`. Refuses mutating `kubectl` without an explicit `--context`. Judges the command inside `aws-vault exec <profile> -- …` by the same rules, and puts `aws-vault login` or a bare `aws-vault exec <profile>` (an interactive shell) in your prompt box as `! …` instead of running it (left out when the box holds a draft, so the draft is kept). |
| [`secret-guard`](secret-guard) | Blocks Bash and Read access to `.env` files (not `.env.example`) and to `~/.claude.json`. Masks JWTs, AWS/GitHub/Slack/Anthropic/OpenAI/Google keys and private key blocks in Bash and Read output before Claude sees them. |
| [`branch-base`](branch-base) | Rewrites `git checkout -b`, `git switch -c` and `git worktree add` with no start point to start from `origin/<base>` after a fetch, and adds `--base <base>` to `gh pr create`. When a repo has no such branch, asks you which base to use (remembered per repo until reload). |
| [`read-only-lock`](read-only-lock) | After a look-only prompt ("just investigate", "plan first, don't change anything", or Korean equivalents such as "확인만 해"), blocks file edits and mutating commands and shows a one-line band with an **Unlock** button. "go ahead", "apply it" or the button unlocks. |
| [`deploy-watch`](deploy-watch) | After `git push` or `gh pr create`, polls GitHub Actions for that commit every 30 s; after `gh pr merge`, for the merge commit GitHub made on the base branch, where deploy workflows run (an auto-merge is followed until it lands); after `gh workflow run`, for the dispatched workflow. Raises a toast and a notification when the runs finish and sends the result to Claude as a message that starts a turn (a push that started no runs is only noted, without starting one), so Claude reports it and picks up work that was waiting on CI without watching CI itself. `/ci` opens a pane with the runs. |
| [`approve-blocked`](approve-blocked) | When the auto-mode classifier blocks a Bash command, asks you **Run** or **Don't run** in a dialog instead of leaving Claude to tell you to run it with `!`. **Run** runs the call again past the classifier (a `permissions.deny` rule still stands); if the classifier blocks it again, the command goes into your prompt box as `! …` so Enter runs it. **Don't run** tells Claude not to hand the command to you. A call prod-guard already had you confirm is not asked about twice. |

## Install

Requires Claude Code v2.1.287 or later (mods are on by default). At the prompt of a terminal session:

```
/plugin install prod-guard --marketplace blackironj/claude-mods
```

Answer `y` to add the marketplace, then pick a scope (user scope loads it in every session). Repeat for each mod you want: `secret-guard`, `branch-base`, `read-only-lock`, `deploy-watch`, `approve-blocked`.

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
- `approve-blocked` turns every auto-mode block of a Bash command into a question for you, so pressing **Run** overrides the classifier for that one call: read the command first. Other tools the classifier blocks are left as they are.
- `prod-guard` lets a call you confirmed run even where a permission rule or the auto-mode classifier would stop it, and its `aws-vault` handoff puts a command Claude wrote into your prompt box: a `!` command runs in your shell with no permission check, so read it before pressing Enter.
- `prod-guard` lets `aws-vault exec <profile> -- …` run in Claude's shell, which has no terminal for prompts. When the session needs an MFA code or a key-store passphrase, the command fails; run one `aws-vault` command yourself with `!` to refresh the session.

## Development

Each mod is a plugin folder (`.claude-plugin/plugin.json`, `hooks/hooks.json`, a TypeScript hooks module, tests). There is no build step: Claude Code loads the `.ts`/`.tsx` sources directly. See [CLAUDE.md](CLAUDE.md) for the layout, checks and conventions.

```bash
claude plugin validate prod-guard   # what the module hooks and calls, and anything the engine would refuse
claude plugin test prod-guard       # runs prod-guard/tests/*.test.ts against the engine
claude --plugin-dir ./prod-guard    # a session with your working copy loaded and hot-reloaded
```

## License

[MIT](LICENSE)
