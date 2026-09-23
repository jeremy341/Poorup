# Manual CodeScene review workflow

CodeScene is a release review gate, not an automated code-writing agent. The
repository never stores a CodeScene token and never starts a background polling
or refactoring loop.

## Run a local delta

From the repository root, set `CS_ACCESS_TOKEN` in the current process and run:

```powershell
./scripts/codescene-delta.ps1
```

The script compares the current branch with `origin/main`, fails closed when
the token or merge base is missing, and writes the redacted command output only
to `qa-artifacts/codescene/delta.json` (which is ignored by Git). It never
prints the token. Pass a different path only when it remains inside
`qa-artifacts/`.

## Manual Luna handoff

Use the explicit task prompt:

```text
CodeScene für PR <number> reparieren
```

Give the Luna task the PR diff and the CodeScene findings only. The task must:

1. write a regression test at the public seam;
2. apply the smallest behavior-preserving fix;
3. run the affected tests, server/client lint, and `git diff --check`;
4. report the exact evidence and push only to the PR branch when separately
   authorized.

## Stop conditions

Stop after three failed fix rounds, any security ambiguity, gameplay-semantic
disagreement, a changed PR SHA, or exhausted Codex quota. Leave the PR open and
report the blocker. Do not suppress a finding merely to make the check green.

OpenRouter, Google keys, `/cs-agent` triggers, and background polling are
intentionally outside this workflow; a future user-owned Action is a separate
project.
