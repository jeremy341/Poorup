---
name: poorup-code-quality
description: Use when triaging Poorup bugs, gameplay or balance defects, security/privacy issues, flaky tests, release regressions, AI-slop code, or architecture debt.
---

# Poorup Code Quality

## Overview

Use this skill to find reproducible root causes and make narrow, safe corrections across Poorup's vanilla client/server game. Treat executable behavior and fresh evidence as authoritative; audit prose is a lead, not proof.

## Evidence-first triage

1. Read `git status`, the exact diff, `AGENTS.md`, relevant design/architecture docs, failing output, and nearby tests. Preserve dirty files and never inspect private backup contents.
2. Reproduce the defect. Trace the bad state through client action, Socket.IO seam, server authority, persistence, and cleanup.
3. State one falsifiable cause. Separate confirmed behavior from hypothesis, stale audit prose, intended rules, and missing evidence.
4. Add the narrowest regression test at the public boundary, observe it fail for the reported reason, make one root-cause change, and rerun focused then broader checks.

## Poorup invariants

- Keep server authority, request idempotency, replay protection, atomic settlement, account lifecycle cleanup, privacy redaction, and reconnect ownership explicit.
- Pending payment allows intended rescue paths such as trades, player/bank loans, and mortgages. It blocks market and casino actions and cannot be ended by an unrelated turn action.
- Disconnect expiry must remove the seat from turn order and settle or release deeds, contracts, auctions, payments, and market positions exactly once. A reconnect must prove seat ownership.
- Validate configured AI URLs against normalized/resolved IP ranges, including IPv4-mapped IPv6, trailing dots, redirects, localhost, and metadata endpoints.
- Prefer HttpOnly cookie sessions; do not persist long-lived bearer credentials in localStorage.
- Treat AI, telemetry, and balance hypotheses as advisory. Verify game outcomes with deterministic tests or simulations and label sample size.

## Parallel review and scope

Use agents only for independent areas with disjoint file allowlists. Read `git status` before delegation, never let agents edit overlapping files or dirty user changes, and review every diff. Keep UI paths out of backend fixes; frontend changes must follow $poorup-frontend.

## Common false positives

- An old audit claim is not a bug until current code or a reproducible test confirms it.
- A test that conflicts with canonical schema/rules may be stale; establish intended behavior before updating either side.
- Large files are maintainability risks, not automatic release blockers. Avoid broad refactors during bug fixes.
- Do not weaken/delete tests, suppress findings, or claim a pass from source inspection.

## Completion evidence

Report each finding with severity, reproduction or source evidence, affected paths, exact fix, and remaining risk. State every verification command and result. If a test cannot run, report the blocker and do not call the change verified.

## Output

Return prioritized findings with severity, source line, proof/reproduction, impact, and a minimal fix. Separate confirmed bugs from risks, stale audit claims, and optional refactors.
