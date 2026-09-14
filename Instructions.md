# Poorup Quick Guide

Guest play is the default entry path: no account is required to create or join
a room. Optional accounts add a durable identity and server-backed history;
account deletion, export, and retention behavior remain policy-gated.

## Goal
Try to bankrupt the other players by buying properties, charging rent, trading smartly, and managing your cash.

## How a Turn Works
1. Roll the dice on your turn.
2. Move your token to the space you land on.
3. Resolve that space:
   - Buy the property if you want it and can afford it.
   - Pay rent if it belongs to someone else.
   - Handle taxes, cards, jail, or other special spaces.
4. End your turn when you are done.

## Properties and Rent
- Buying properties gives you income through rent.
- Owning a full color set usually makes properties stronger.
- Houses and hotels increase rent.
- Mortgaged properties do not collect rent until they are released.

## Trading
- You can trade with other players during the game.
- Trades can include:
  - Cash
  - Properties
- You can offer something, request something, or do both.
- Trades only work if both players agree.

## Houses and Hotels
- Build evenly across a full color set.
- You cannot build unevenly if the even-build rule is enabled.
- You must have enough cash to build.
- Selling buildings gives you cash back, but lowers rent.

## Jail
- If you are in jail, you can:
  - Roll doubles
  - Pay the jail fine
  - Wait out your turns if the rules allow it

## Bankruptcy and Elimination
- You are not eliminated just because you are low on cash.
- If you cannot pay a debt, you may mortgage, sell buildings, trade, or declare bankruptcy.
- You are only out once you choose to declare bankruptcy or the game rules remove you.

## Game Setup
- The host can adjust settings before the game starts.
- Settings may include the board variant (Standard-40 or Metro-52), ruleset
  preset, starting cash, turn timer, CPU seats, auctions, mortgage rules, and
  other supported house rules. Standard-40 supports up to four seats; Metro-52
  supports up to six.
- Rulesets are named `CLASSIC`, `AFTER HOURS`, or `CUSTOM`; the host controls
  which supported overrides are applied before the round starts.

## Optional Systems
- **Auctions:** A declined property may enter a timed auction when the host
  enables the auction rule.
- **Contracts:** Player loans and property-equity contracts use server-settled
  collateral, repayment, and default rules.
- **Casino and Market:** These are optional, fictional-currency systems. Market
  complexity can include basic orders, margin, shorting, and derivatives under
  the configured server rules.
- **Events:** Global Events are round-scaled shared effects with warnings,
  choices, recovery, and curated combinations.
- **Bots:** CPU seats are server-controlled and use selectable deterministic
  personalities.
- **Social and seasons:** Optional accounts can expose friends, recent players,
  match history, achievements, cosmetics, rankings, and seasonal rewards where
  the corresponding surface is available.

For source-backed status and policy-gated work, see
[docs/feature-status.json](docs/feature-status.json).

## Winning
- Keep your assets alive, manage cash carefully, and be the last player remaining.
