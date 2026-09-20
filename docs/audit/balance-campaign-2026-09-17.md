# Deterministic balance campaign — 2026-09-17

## Scope

This is a release-hardening stability and balance measurement, not permission to
change numeric rules. The runner used the existing bot simulation seam with
fixed seeds, the release balance revision `release-hardening-2026-09-16`, and
the current server rules. It did not retain player names, account IDs, room
codes, or private bot prompts.

Command:

```powershell
$env:POORUP_BOT_BALANCE_COUNT = '10000'
node server/bot-balance-runner.js
```

## Observed output

| Measure | Result |
| --- | ---: |
| Games requested | 10,000 |
| Completed within 2,000 steps | 9,812 (98.12%) |
| Bounded at the step limit | 188 |
| Invariant stalls | 0 |
| Games with at least one bankruptcy | 9,997 (99.97%) |
| Median duration | 27 rounds / 560 steps |
| P95 duration | 98 rounds / 1,328 steps |
| Auction adoption | 100% |
| Casino adoption | 100% |
| Market adoption | 100% |
| Global Event action adoption | 63.38% |

Winner share by starting seat:

```text
seat 0: 0.9686
seat 1: 0.0007
seat 2: 0.0119
unknown: 0.0188
```

## Interpretation

The seat-0 result is a high-priority fairness hypothesis, not a proven rules
bug. This run fixes the host/personality order and is bot-only, so starting seat,
personality, and first-action opportunity are confounded. The near-universal
bankruptcy rate is expected for a three-seat elimination campaign and needs
timing and cause buckets before any economy change.

The 188 bounded games are reported separately and are not counted as completed.
Zero invariant stalls is a useful liveness signal, not evidence that every game
is short enough for a player-facing promise.

## Required follow-up before tuning

- randomize starting seat and personality order;
- run Classic, After Hours, Custom, Standard-40 and supported Metro variants;
- compare bot-only with human-involved fixtures;
- record feature opportunity, legal use, denial, settlement, rescue and fallback;
- report confidence intervals with the fixed minimum cohort `k >= 5`;
- separate bankruptcy cause and round timing from simple bankruptcy counts.

No rent, loan, auction, casino, market, event, airport, or starting-cash value
was changed from this measurement.
