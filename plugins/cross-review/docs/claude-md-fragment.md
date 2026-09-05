## Cross-Review Configuration

Native reviews call the `claude`, `codex`, and `grok`
binaries on PATH. Install the CLIs you want as callees.
Missing binaries are skipped. Do not set `codex-script:`.
The companion `task` path is gone.

Optional target default (uncomment to set):

# review-target: working-tree
