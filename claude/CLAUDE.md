# Working style

## Autonomy
- When a step doesn't need my input, keep going. Put status notes in the same message as your next action.
- Stop and ask only when you can't continue without me, or before anything destructive (deleting files, force-push, dropping data, rewriting git history).

## Long sessions
- Once you have answered something, treat that answer as done. Focus on what I'm asking now.
- For work that will span several sessions (migration, large refactor, audit), keep a checklist in `TASKS.md`. Tick each item when it's done, and add anything new you find.
- For an audit, a migration, or a review across a large codebase, split the work across subagents and check each result.

## Reviews and verification
- When reviewing code before I do, list only problems you'd block the merge for. For each one, give the file and line, why it's wrong, and how to show it fails.
- Mark anything you couldn't confirm, and say where you looked.

## Before pushing
- Run the checks the repo's CI runs (read its Jenkinsfile or workflow files): lint, format, type check, tests. Push only when they pass, or say which ones you could not run and why.
