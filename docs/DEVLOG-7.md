# Poorup Redesign - Devlog #7

This phase was mainly about doing a full audit over the game, fixing bugs which were still hidden inside the server and UI, and making the whole project easier to trust before the next merge.

# Audit and Bug Fixes

I ran five separate audits over the codebase, the UI, the UX, the documentation, and the architecture. This found real problems instead of just cosmetic things. I fixed the ruleset switching bug where a Custom room could keep the wrong Classic or After Hours base, fixed contract counters being sent to the wrong player, and made unpaid card payments stay as real debts instead of silently disappearing.

I also fixed the advanced market actions so opening margin, reducing margin, covering shorts, exercising options, and closing positions all use the same one-action-per-turn rule. Margin now reserves disclosed collateral and releases it correctly when the position is reduced or liquidated. Match history is also enriched with achievements and season data before it is stored, so restarting the server does not lose those details.

# Quick Table

Quick Table used to create a new public room every time. It now checks the live public room directory first, joins the most suitable open table, retries if somebody fills it during the join, and only creates a new Standard-40 room when no table can be joined. Private room codes are never exposed and the server still makes the final decision.

# UI and UX

I cleaned up many small but annoying interactions. Closing a purchase card no longer passes by accident, hidden controls no longer enter modal focus traps, auction updates keep the focused button, and the turn timer stays visible while a turn is resolving. Partial player-loan repayments now send the amount entered instead of always paying everything.

The log drawer now refreshes without throwing away the reader's scroll position. Social, rankings, and season requests show loading, retry, timeout, and stale-data states. Rejected lobby settings roll back the optimistic value and explain what happened. I also added skip links, page headings, readable mobile inputs, stronger iPad touch targets, event-summary wrapping, and removed duplicate status elements.

# Documentation and Architecture

All audit reports are now saved in Markdown and the feature-status manifest records what is live, partial, shell-only, or future. I corrected stale plans and kept historical audits instead of deleting project history. I also added a small match-history adapter so both social readers use the same merge and precedence rules without introducing another service or a second game engine.

# Testing

I expanded the contract tests and added focused tests for the transactional UI, responsive accessibility, Quick Table, server socket relays, and match-history adapter. The complete regression suite and audit suite pass. The browser matrix passed 154 tests with 32 intentional skips across desktop, tablet, iPad landscape, and mobile. Coverage finished at 89.99% statements and 77.63% branches.

I also ran the visual checks at 1920px and inspected the home captures for the original and seasonal themes. The original Poorup baseline is still unchanged. CodeScene preparation is complete, but the authenticated delta review still needs the repository token in the environment.

# Music Candidates

I downloaded three CC0 tracks for each new theme into a separate listening pack so I can test them without changing the original soundtrack. There are candidates for Spring, Summer, Autumn, Winter, and Light, while Pondering the Cosmos stays untouched for the original theme.

# Next Steps

The next step is a final human review of the complete diff, followed by the authenticated CodeScene check. After that I want to choose the final theme music, wire only the winners into the selector, and prepare the branch for merge.

I did not take new screenshots for every changed surface yet, so I will include those in the next devpost.
