## Next issue binding

The `next-issue` plugin reads these values. Fill them
in. Where this section conflicts with the rest of this
file, follow the rest of this file.

An older heading `## Next TODO binding` is still
accepted.

1. **Backlog** — the GitHub repository that holds the
   issues. Example: GitHub Issues on `owner/repo`. The
   labels are the state: `parent` marks a category
   issue; a child issue carries `ready`, `in-progress`,
   or `blocked`. A child issue is one pull request. The
   Children list in the parent issue body orders the
   children. `TODO.md` is an archive, not the live
   picker.
2. **Plan** — where the plan artifact lives. Example:
   `.agents/plans/` (gitignored) or
   `docs/plans/YYYY-MM-DD-<slug>.md`. A local Plan may
   refine child order for one session.
3. **Spec** — spec file(s) and the approval rule before
   code against a new spec or design note.
4. **Gates** — local commands that must pass before each
   commit.
5. **CI** — required checks the parent waits on. The
   pull request base is `main`.
6. **Review axes** — leave unset to use the plugin
   defaults (Grok, Astra, Opus 5). Name replacements here
   when they differ.
7. **Rules** — which files hold TDD, style, and
   dependency rules (usually this file and
   `CONTRIBUTING.md`).
8. **Claims** — optional. A command that takes one
   issue number, takes a lock on it, and prints the
   directory to work in. Exit 3 means held. Leave
   unset for one agent per checkout.
