# Modal action rules

These rules cover Poorup's desktop and landscape tablet game surfaces. The board stays dominant; keep the after-hours parlor styling, real server-authoritative actions, and no document/body scrolling. The action matrix below is a design target, not a claim that all current screens comply. Phone presentation is outside this review.

## Hierarchy and placement

- Give the user's main decision the filled red primary treatment (`cta-red`): usually a positive action such as Create, Join, Send, Buy, Accept or Borrow. Show one primary action per decision. When the only enabled decision is Decline or Cancel, it may be the red primary; label its effect and confirm it when needed. If there is no meaningful next action, do not invent one; an informational surface can close.
- Use the dark outlined treatment (`btn-dark`) for secondary actions, navigation, alternatives and safe cancellation. Put footer actions in a stable order: secondary or safe action on the left, primary or confirming action on the right. Keep labels and the order stable as state changes; when space is constrained, wrap or stack in the same reading and focus order.
- An X in the upper-right dismisses the surface only; give it an accessible name describing the result. Escape and scrim dismissal must have the same safe meaning when available. Never make dismissal silently decline, pass, spend, cancel a request, or leave a game. A Back control is warranted only when it moves to a distinct prior step or surface; omit it when it duplicates X. A named Cancel may remain in an explicit confirmation as a clearly visible safe choice, even when X also cancels; do not add a redundant Back as well.
- A required decision can be dismissed only if the unresolved state remains available and the consequence is explained. If dismissal would discard meaningful work or conceal a blocking decision, preserve the draft or ask before closing. For an active auction or required purchase decision, closing leaves the game decision pending; it is not Pass.
- Destructive or irreversible actions must name the consequence, be separated from routine choices, and have a safe alternative. Explain the impact before deliberate confirmation; focus the safe option initially. A final confirmation can use the red primary treatment, but red alone never communicates danger: use an explicit action label and warning as well. Do not conflate ordinary declines or purchases with leaving a game or deleting an account.
- Show actions relevant to the current player's role and state. A genuine unavailable action can remain visibly disabled with a nearby, specific reason associated programmatically; pending requests should show progress, prevent repeats, and surface failure/retry. Do not show fake enabled controls. Remove stale choices when server state changes; don't promise that a client-side state is authoritative.
- Group equivalent alternatives as choices rather than competing primary CTAs. Auctions may offer multiple meaningful bid increments together; their visual weight should communicate a set of choices without implying one is the single recommended bid.

## Accessibility and layout

Use a named modal dialog with a clear title and relevant description, semantic buttons and form labels, visible focus, and keyboard-operable choices. Move focus inside on open, contain it while modal, restore it to the invoker or a meaningful fallback on close, and return focus appropriately after an in-place state replacement. Do not place initial focus on irreversible confirmation. Announce errors and meaningful state changes without relying on color. Keep the action region reachable at 200% zoom and short landscape heights: scroll the modal body internally, provide a visible overflow cue, and avoid nested competing scroll areas or page scrolling. Focus must not be hidden behind a sticky footer. Preserve the existing reduced-motion and contrast requirements.

## State and action matrix

The table describes intended semantics; actual visible actions depend on role, eligibility and server state. X means neutral dismissal, not an implied response.

| Surface or state | Positive / main action | Secondary / navigation | Destructive or consequential action |
| --- | --- | --- | --- |
| Room browser, create, join | Join selected room; Create & Host; Join Room | filters, tabs, X | none |
| Account sign-in, registration, edit; recovery | Sign In, Create Account, Save, or Send Verification | mode tabs, X | account deletion requires typed confirmation and password; name its delayed deletion consequence |
| Achievement, rankings, social, player and card details/gallery | contextual real action when available; otherwise none | X / Close; gallery navigation | social actions only when eligible; label any removal explicitly |
| Property purchase | Buy, when affordable | Auction in auction mode; Pass in normal mode; X leaves the choice pending | Pass and Auction are explicit game decisions, never dismiss aliases |
| Live auction | bid increment choices, when permitted | Close leaves auction active; pass if actually offered by the state | bids commit cash; show amount and eligibility |
| Trade builder / incoming offer | Send trade, counter or adjustment; Accept trade | Negotiate, Decline, X keeps offer pending | acceptance transfers the displayed assets; make consequences clear |
| Deed manager | Build or other legal action appropriate to ownership | trade, mortgage/redeem, sell, X as applicable | selling or mortgaging has named game consequences; show availability and reasons |
| Financing builder, negotiation, contract | Send contract/counter/adjustment; Repay when available | mode and term choices, X | disclose obligations, collateral, and default; applicable cancellation/termination must be explicit |
| Emergency bank loan | Borrow with amount | Cancel (safe confirmation choice) and X | show repayment, deadline and default/collateral before borrowing |
| Wallet, market, casino, flight | the currently eligible transaction: order, spin, book, or applicable wallet action | selection, navigation, X | disclose amount and risk for real commitments; close position means a transaction, not closing the dialog |
| Purchase funding request / active funding | Request Funding; Reserve; Accept & Buy when eligible | X keeps current request, Withdraw where eligible | Cancel Request is an explicit state-changing action; show escrow and terms |
| Deal details | Accept or other currently available action | Negotiate, decline, view details, X as appropriate | cancellation/termination requires clear effect and confirmation when irreversible |
| Debt payment / bankruptcy | recovery routes such as Holdings, Trade, Financing | Close returns to table with decision still pending | Declare Bankruptcy then explicit Confirm Bankruptcy, with safe Keep Playing; show consequences |
| Voluntary retirement | none as a routine positive primary | Keep Playing | Retire / Hand Over Assets in an explicit confirmation; disclose irreversible effect |
| Card reveal and round over | acknowledge reveal; host Rematch when available | Back to Lobby; explain host-only disabled Rematch | no implied destructive action; Back to Lobby is a destination, not duplicate X |
| Generic confirmation | named confirm action only if safe/positive | Cancel | named destructive confirmation and its consequence when applicable; no generic ambiguous Confirm |

## Current application and remaining review

- Deal details use X to dismiss, show role-appropriate actions, and put the enabled red decision at the end of the row. Old loans can be negotiated into a current offer; Finance-off controls are disabled with an explanation. Decline/Cancel remains a real server-authorized decision.
- Funding places Cancel Request before the red Accept & Buy. Market order submission is red. Auction bid increments have equal outlined weight because there is no recommended amount. An achievement's close-only button is neutral.
- The existing debt-rescue and retirement dialogs keep the previously requested layout. Their irreversible actions already use named consequences, a confirmation step where applicable, and safe initial focus; their historical ordering remains an explicit exception to the preferred footer order.
- The bank-loan confirmation retains both X and a labelled Cancel: both are safe choices at a consequential confirmation, and neither submits the loan.
- This is a shared rule set and a source audit, not a claim that every historical dialog has been visually redesigned. Check additional states against the matrix when they change, especially long text, pending/error states and narrow effective viewports.
