# next-todo

Land one `TODO.md` PR slice: choose the next slice, write
a plan, review it to consensus, implement with red-green
TDD, open a draft pull request, and drain review comments
until CI is green.

## What it does

The procedure is generic. A project supplies seven
binding values in its own `CLAUDE.md`. The skill stops
if that section is missing.

`/next-todo` runs the whole loop for one slice. Do not
skip the plan review. Do not skip the comment drain. Do
not start a second slice in the same change.

Plan and patch review use a brief plus split axes (Grok,
Sol, Opus 5 by default). A non-behavior exception uses
Sol only. The parent watches CI. Reviewers do not poll.

## Install

```
/plugin marketplace add kelp/agent-plugins
/plugin install next-todo@agent-plugins
```

## Setup

1. Run `/next-todo-init` to append the binding template
   to the project's CLAUDE.md
2. Fill in backlog, plan, spec, gates, CI, review axes,
   and rules

## Use

```
/next-todo
/next-todo <slice heading>
```

With no argument, the skill picks the next slice from
the backlog binding. With an argument, that heading is
the slice, if its predecessors are already on `main`.

## Composition

This plugin is the operating procedure for one slice.
`CLAUDE.md` holds project rules and the binding.
`tdd-pipeline` can be the implement step. `fleet-lead`
can name `next-todo` as a pipeline. There is no
code-level coupling.

## Skills

**User-invocable:**
- `next-todo` -- land one TODO.md PR slice
- `next-todo-init` -- add the binding template to
  CLAUDE.md

## Reference

- [CLAUDE.md Fragment](docs/claude-md-fragment.md) --
  binding template
