---
name: fleet-lead
description: Run a two-lead agent fleet against one repo: a drive lead that claims work units, commits and opens PRs, and a gate lead that watches CI, drains review comments, and restarts the drive lead when it stalls. Read when starting or joining a fleet, claiming or releasing a unit, or when a unit has gone quiet. Covers unit claiming with a file-disjointness check, heartbeats, and restart from a ledger.
---

# Fleet Lead (two leads, one ledger)

Two long-lived sessions run several work units against one repo.
The leads do not write code. They claim work, hold the gates, and
delegate every change to the project's pipelines.

This is the operating procedure for the sessions above the fleet.
For the token rules inside a fan-out, read the sibling
`fleet-efficiency` skill before dispatching three or more agents.

## When to use

Use it to start a fleet, to join one as the second lead, to claim
or release a unit, or when a unit stops reporting.

Do not use it for one unit. A single change goes straight to the
project's pipeline; a fleet around it is pure overhead.

## Why two leads

Only a main loop can sign a commit. Subagents inside a workflow
cannot, so every unit returns to a session to commit.

A session waiting at that gate looks exactly like a session doing
work. Signing agents drop: an SSH key held by a password manager
loses its host connection after sleep or a reconnect, and the
commit hangs until a human refreshes the session. The gate lead
exists to notice, because nothing else does.

Restarting is the second reason. A lead that dies takes its
context with it, and a fleet with no second lead stalls until the
human looks.

## Roles

**Drive lead** (`lead-drive`): picks units, claims them in the
ledger, dispatches the pipelines, signs the commits, opens the
pull requests. The only writer of the ledger.

**Gate lead** (`lead-gate`): watches CI, drains review threads,
runs the cross-platform checks, reads heartbeats, restarts a dead
unit. Never writes the ledger; sends what it wants changed to
`lead-drive` over SendMessage.

Two writers on one ledger is the failure this split prevents.
Keep the single-writer rule even when the drive lead is busy.

## Names

Names are SendMessage addresses. Keep them stable across a
restart, so a ledger row still points at a live agent.

- Leads: `lead-drive`, `lead-gate`.
- Unit owning one component: `unit-<component>`.
- Unit owning shared code: `unit-common-<topic>`.

Find an agent with `ListAgents` and copy the name exactly. Never
guess a name, and never invent a second name for a unit that
already holds a ledger row.

## Claim a unit

Do these in order. Step 3 is the one nothing else enforces.

1. Read the in-flight table in the ledger.
2. Name the files the candidate unit will touch: implementation
   and tests.
3. Reject the candidate when that set intersects any in-flight
   row's files. Wait for the holder to land instead.
4. A unit that touches shared code runs **alone**. A shared-code
   change reaches every consumer, and it cannot land in a
   parallel worktree without collisions.
5. Stop at the project's unit cap, three to four by default. Past
   that, wall clock is dominated by build contention rather than
   unit size, so the next unit mostly waits.
6. Stop at three in-flight pull requests. CI is one queue, and
   every extra open branch buys a rebase.
7. Give the unit its own worktree, a sibling of the main
   checkout: `git worktree add <wt_root>/<repo>-wt-<unit> -b
   <branch>`. The main checkout stays read-only for every unit.
8. Write the row: unit, lead, agent name, worktree, phase, UTC
   heartbeat.

Phases are `plan`, `red`, `green`, `review`, `pr`, `drain`.

## Heartbeat

Fifteen minutes. Use `/loop` or `Monitor` rather than a bare
sleep, and keep the interval the same for both leads.

Each tick, the drive lead writes the UTC minute into every row it
owns, and the gate lead sends one SendMessage ping to
`lead-drive`. A tick that finds nothing changed is a quiet tick;
say so and stop there.

A unit is presumed dead when any of these holds:

- Two intervals with no heartbeat.
- Two intervals where the phase says work is in progress and
  `git -C <worktree> status --short` is unchanged.
- A commit that has been in progress longer than one interval.
  That is the signing stall.

## Restart

You cannot resume another session's interrupted turn. Recovery
comes from the ledger and the worktree, never from the dead
session's context.

1. Read the row: unit, worktree, phase, agent name.
2. Run `git -C <worktree> status --short` and
   `git -C <worktree> log --oneline -5` to find the real phase.
   Trust the worktree over the row, and correct the row.
3. Re-dispatch that phase under the **same** agent name.
4. When the stall is signing, do not work around it. Never
   disable commit signing to get past it. On a developer machine,
   stop and ask the human to refresh the agent session; where
   signing is provisioned by the environment, a failure is a real
   bug to surface.
5. Record the restart and its reason in the row.

Two restarts on the same unit means stop and ask the user. A unit
that dies twice is a broken unit, not an unlucky one.

## Project binding

The procedure above is generic. A project supplies six values,
in its own `CLAUDE.md` or process doc:

1. **Ledger** — the file and table holding in-flight rows.
2. **Unit** — what one unit is, and where the backlog lives.
3. **Worktree root** — where unit worktrees are created.
4. **Caps** — concurrent units and in-flight PRs, when they
   differ from four and three.
5. **Gates** — the commands a unit must pass before a commit,
   and the CI checks the gate lead waits on.
6. **Pipelines** — what each phase dispatches to, for example
   the `tdd-pipeline` plugin or a project workflow.

Read those before claiming anything. Where this skill conflicts
with the project's own process docs, follow the project.

## What not to do

- Do not let both leads write the ledger.
- Do not run two units that touch shared code, or one
  shared-code unit beside anything else.
- Do not exceed the unit cap or three in-flight PRs.
- Do not commit from inside a workflow subagent. Commits happen
  in a main loop, because that is where signing works.
- Do not work in the main checkout. Every unit owns a worktree.
- Do not guess an agent name. Use `ListAgents`.
- Do not restart the same unit twice without asking the user.
- Do not merge, enable auto-merge, or mark a PR ready unless the
  user asks.
