# privacy-radar as a GitHub Action

<!-- [ACT-03] -->

privacy-radar ships a composite action (`action.yml` at the repository root). It runs the CLI with deterministic rules only (`--llm none`), so no API key or secret is needed, and it produces a SARIF file for GitHub code scanning and, on pull requests, a Markdown comment with one compliance sentence per added or resolved finding. This is not legal advice and not a complete assessment.

## Complete workflow

```yaml
name: privacy-radar
on:
  pull_request:
  push:
    branches: [main]

permissions:
  contents: read
  security-events: write   # upload-sarif needs it
  pull-requests: write     # gh pr comment needs it

jobs:
  scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
        with:
          fetch-depth: 0   # PR mode reads both revisions from the local history

      - id: radar
        uses: flaviorg/privacy-radar@v0.1.0
        continue-on-error: true   # keep going so the SARIF and the comment are published
        with:
          path: .
          regime: both
          fail-on: error
          min-confidence: "0.5"
          base: ${{ github.event.pull_request.base.sha }}   # empty on push: full scan

      - uses: github/codeql-action/upload-sarif@v4
        if: always() && steps.radar.outputs.sarif-file != ''
        with:
          sarif_file: ${{ steps.radar.outputs.sarif-file }}
          category: privacy-radar

      - name: Comment on the pull request
        if: always() && github.event_name == 'pull_request' && steps.radar.outputs.comment-file != ''
        env:
          GH_TOKEN: ${{ github.token }}
          COMMENT_FILE: ${{ steps.radar.outputs.comment-file }}
          PR_NUMBER: ${{ github.event.pull_request.number }}
        run: gh pr comment "$PR_NUMBER" --body-file "$COMMENT_FILE"

      - name: Fail the check when findings reach fail-on
        if: steps.radar.outputs.exit-code == '1'
        run: exit 1
```

## Inputs and outputs

| Input | Default | Meaning |
|---|---|---|
| `path` | `.` | Folder to scan (full scan) or repository root (PR mode) |
| `regime` | `both` | `lgpd`, `gdpr` or `both` |
| `fail-on` | `error` | `error`, `warning`, `note` or `none` |
| `min-confidence` | `0.5` | Findings below it stay in `findings.json` only (full scan) |
| `base` | empty | Base ref of PR mode; empty runs a full scan |

| Output | Meaning |
|---|---|
| `sarif-file` | Path of `findings.sarif` (empty when the CLI failed with exit code 2 or 3) |
| `comment-file` | Path of `pr-comment.md` in PR mode; empty otherwise |
| `exit-code` | `0` nothing at or above `fail-on`, `1` findings at or above it, `2` usage or configuration error, `3` scan or Git error |

## How it behaves

- **No secret, no model.** The action always runs `scan ... --llm none` or `pr` (which never calls a model), so it needs no `LLM_API_KEY` and its verdicts never depend on a model or a fixture.
- **Outputs survive a failing scan.** The step captures the CLI's exit code with `|| code=$?`, writes `code`, `sarif` and `comment` to `$GITHUB_OUTPUT`, appends `pr-comment.md` to the job summary, and only then exits with that code. With `fail-on: error` and errors found (exit 1), `sarif-file` and `comment-file` are still set, so `upload-sarif` and the comment step under `if: always()` still run.
- **PR mode needs the history.** `base: ${{ github.event.pull_request.base.sha }}` plus `fetch-depth: 0` lets the CLI export both revisions with Git; a ref that starts with `-` or does not resolve to a commit fails with `GIT_ERROR` before any other Git call. More than 500 changed files fail with `PR_TOO_LARGE`.
- **TypeScript without a build.** The CLI runs from `$GITHUB_ACTION_PATH` (`node "$GITHUB_ACTION_PATH/src/cli.ts"`), not from `node_modules`, so Node strips the TypeScript types natively; Node refuses to strip types for files under `node_modules`. The Node version comes from the action's own `.nvmrc` through `actions/setup-node`.
- **No script injection.** Inputs reach the shell only through `env:` and are quoted as `"$INPUT_X"`; no `${{ inputs.* }}` expression appears inside a `run:` body.
- **A pull request cannot silence itself.** PR mode scans the base and head revisions with the base revision's `privacy-radar.config.json`; suppressions or `ignore` globs added by the pull request take effect only after merge, and the comment says when the config changed.
- **Symbolic links are not followed**, so a pull request cannot make the scanner read a runner file through a link.
