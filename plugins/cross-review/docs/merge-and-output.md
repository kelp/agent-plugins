# Merge and Output Reference

The harness CLI already groups findings that share a
file and have line numbers within 2. The dispatcher
prints that grouping. It does not re-run a second
model to confirm or dispute each finding.

Native reviewers do not share a schema. Translation
into `{file, line, severity, title, body}` is
best-effort. Always keep `native.raw` so nothing from
the original review is thrown away.

## What to print

**One callee.** Print that harness's review. Do not
invent a merge section.

**Several callees.** For each harness, print:

```
## <harness> (<ok|failed>)

<summary>
<each finding: [severity] title (file:line)>
```

Then print the CLI `merged` groups:

```
## Overlapping locations

- file:line — seen by: claude, grok
  - claude: <title>
  - grok: <title>
```

A location group with one harness is unique to that
reviewer. A group with several harnesses is the same
spot, not proof they found the same bug. Say so.

Skip a harness whose binary was missing. Say which
ones were skipped.

## What not to do

- Do not apply patches or run `/code-review --fix`.
- Do not drop `native.raw` if the user asks for the
  verbatim review.
- Do not treat location overlap as confirmation.
