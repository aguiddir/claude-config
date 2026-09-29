# Git commit messages

Applies whenever you write a commit message or a PR description.

## When to commit

- Commit when a task is done, on the current branch. Create a branch first if you are on `main`/`master`, unless I say otherwise.
- Never push unless I ask.

## Review feedback

Changes asked for in a code review go in `git commit --fixup=<sha>` commits, one per commit being corrected (find it with `git blame` or `git log -L`). Don't autosquash: I run `git rebase -i --autosquash` myself.

## Subject

- Follow the repo's history first: check `git log --oneline -20` and match its prefix style (gitmoji, Conventional Commits, ticket key). With no history, use a gitmoji (https://gitmoji.dev).
- English, imperative mood, no trailing period. ~50 characters, never more than 72.
- Name the change, not the file touched: `🐛 Prevent overlapping numeric key partitions`.

## Body

- Mandatory unless the change is a trivial one-liner. Blank line after the subject, wrapped at 72 columns.
- Explain **why**: the constraint, the failure mode, the option not taken, the context the code alone can't tell.
- For a bugfix, name the root cause, and give steps to reproduce the bug when you can.
- Prose, a handful of lines. Bullets only for a genuine enumeration.
- Link public sources when they exist: vendor docs, spec, upstream issue.
- Footer: `Closes #123` for a GitHub issue, `See PROJ-123` for Jira.

## Never

- Don't walk through the edits or restate what the diff shows.
- Don't describe the session ("as requested", "per review feedback"): the message must make sense read alone in two years.
- Don't pad with the obvious ("update tests", "refactor code").
- Don't write an attribution trailer yourself: Claude Code adds it, and the `attribution` setting controls it.
