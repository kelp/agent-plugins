# next-issue

Land one GitHub child issue as one pull request: choose
the next child issue, write a plan, review it to
consensus, implement with red-green TDD, open a draft
pull request, and drain review comments until CI is
green.

Previously `next-todo`. Uninstall that plugin and
install `next-issue@agent-plugins`. An existing
`## Next TODO binding` heading is still read.

## What it does

The procedure is generic. A project supplies seven
binding values in its own `CLAUDE.md`. The skill stops
if that section is missing.

`/next-issue` runs the whole loop for one slice. Do not
skip the plan review. Do not skip the comment drain. Do
not start a second slice in the same change.

Plan and patch review use a brief plus split axes (Grok,
Sol, Opus 5 by default). A non-behavior exception uses
Sol only. The parent watches CI. Reviewers do not poll.

## Install

```
/plugin marketplace add kelp/agent-plugins
/plugin install next-issue@agent-plugins
```

## Setup

1. Run `/next-issue-init` to append the binding template
   to the project's CLAUDE.md
2. Fill in backlog, plan, spec, gates, CI, review axes,
   and rules

## Use

```
/next-issue
/next-issue <issue-number>
```

The backlog is GitHub Issues in the repository the
binding names. A `parent` label marks a category issue.
A child issue carries `ready`, `in-progress`, or
`blocked`. One child issue is one pull request.

With no argument, the skill takes the first child, in
the order the parent issue body gives, that carries
`ready` or `in-progress`. It skips `blocked` children
and `parent` issues. With an issue number, that child is
the slice, and the skill asks no question. In both cases
the skill stops when a blocker holds: a `blocked` label,
a `blocked` parent, or a Depends-on predecessor that is
not yet on `main`.

When it opens the draft pull request, the skill moves
the child from `ready` to `in-progress` and puts
`Closes #<child>` in the body. `TODO.md` is an archive:
the skill checks off a heading only when the child issue
claims it. A defect found during the slice becomes a new
issue, not a `TODO.md` line.

## Composition

This plugin is the operating procedure for one slice.
`CLAUDE.md` holds project rules and the binding.
`tdd-pipeline` can be the implement step. `fleet-lead`
can name `next-issue` as a pipeline. There is no
code-level coupling.

A parent-category orchestrator (`/next-parent`) can run
this skill once per child. That skill is separate.

## Skills

**User-invocable:**
- `next-issue` -- land one GitHub child issue as one PR
- `next-issue-init` -- add the binding template to
  CLAUDE.md

## Reference

- [CLAUDE.md Fragment](docs/claude-md-fragment.md) --
  binding template
