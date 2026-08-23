## Next TODO binding

The `next-todo` plugin reads these values. Fill them in.
Where this section conflicts with the rest of this file,
follow the rest of this file.

1. **Backlog** — file, how to pick the next slice, and
   what one slice is (usually one heading = one PR).
   Example: `TODO.md` **Current work**; open only the
   named heading.
2. **Plan** — where the plan artifact lives.
   Example: `.agents/plans/` (gitignored) or
   `docs/plans/YYYY-MM-DD-<slug>.md`.
3. **Spec** — spec file(s) and the approval rule before
   code against a new spec or design note.
4. **Gates** — local commands that must pass before each
   commit.
5. **CI** — required checks the parent waits on.
6. **Review axes** — leave unset to use the plugin
   defaults (Grok, Sol, Opus 5). Name replacements here
   when they differ.
7. **Rules** — which files hold TDD, style, and
   dependency rules (usually this file and
   `CONTRIBUTING.md`).
