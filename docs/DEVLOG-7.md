# Poorup Redesign - Devlog #7

This phase was mainly about auditing the game, fixing hidden server and UI bugs, and making the project easier to trust before the next merge.

# Audit and Bug Fixes

I ran five audits over the codebase, UI, UX, documentation, and architecture. I fixed the ruleset switching bug where a Custom room could keep the wrong Classic or After Hours base, fixed contract counters being sent to the wrong player, and made unpaid card payments stay as real debts.

Advanced market actions now share one action-per-turn rules. Margin reserves disclosed collateral and releases it on reduction or liquidation. Match history is enriched with achievements and season data before storage, so restarts keep those details.

# Quick Table

Quick Table checks the public directory first, joins the most suitable open table, retries a fill race, and creates a new Standard-40 room only when needed. Private codes stay hidden and the server remains authoritative.

# UI and UX

I cleaned up many small interactions. Purchase dismissal is neutral, hidden controls stay out of focus traps, auction updates keep focus, the turn timer survives resolution, and partial loan repayments send the entered amount.

The log drawer refreshes without losing scroll position. Social, rankings, and season requests show loading, retry, timeout, and stale states. Rejected lobby settings roll back and explain the error. I also added skip links, headings, readable mobile inputs, iPad touch targets, event wrapping, and removed duplicate status elements.

# Documentation and Architecture

Audit reports are saved in Markdown and the feature-status manifest records live, partial, shell-only, and future work. I corrected stale plans while keeping historical audits, and added a match-history adapter so both social readers share merge rules without a second service or engine.

# Testing

I expanded the contract tests with coverage for transactional UI, responsive accessibility, Quick Table, socket relays, and match history. The regression and audit suites pass. The browser matrix passed 154 tests with 32 intentional skips across desktop, tablet, iPad landscape, and mobile. Coverage finished at 89.99% statements and 77.63% branches.

I inspected the 1920px home captures for the original and seasonal themes; the original Poorup baseline is unchanged. CodeScene preparation is complete, but its authenticated delta review still needs the repository token.

# Music Candidates

I downloaded theme music candidates into a separate listening pack, preferring CC0 and clearly marking the two CC-BY options. After listening, I kept the tracks that fit best, moved Apple Cider into the Spring and Summer pools, and replaced the weaker choices with new Spring, Summer, Autumn, Winter, and Light candidates. Pondering the Cosmos stays untouched for the original theme.

# Next Steps

The next step is the final human review and authenticated CodeScene check. After that I want to choose the theme music, wire only the winners into the selector, and prepare the branch for merge.

I did not take new screenshots for every changed surface yet, so I will include those in the next devpost.
