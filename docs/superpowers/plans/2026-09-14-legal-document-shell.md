# Poorup Legal Document Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship complete, readable, same-origin Poorup legal-document pages with a shared shell and clearly labelled owner-review draft copy.

**Architecture:** Keep the existing static legal routes and footer contracts, but replace each HTML document with a shared semantic shell pattern and add scoped CSS to `public/styles.css`. Use small content helpers in `server/legalRoutes.js` only for the hub/alias behavior; do not touch game/server state.

**Tech Stack:** Static HTML, existing vanilla CSS tokens, Express legal router, Node assertion tests, Playwright browser QA.

**Spec:** `docs/superpowers/specs/2026-09-14-legal-document-shell-design.md`

## Global Constraints

- Preserve all game surfaces, gameplay, Socket.IO contracts, board geometry, and footer ticker rhythm.
- Keep legal pages same-origin and JavaScript-independent.
- Use existing Poorup tokens and typography; no new component library or dependency.
- Do not invent operator identity, contact details, retention periods, legal bases, jurisdiction, processor claims, or licenses.
- Mark every document `DRAFT — NOT EFFECTIVE` until owner facts are supplied.
- Confirm native 1920×1080, iPad landscape, mobile, 200% zoom, forced colors, reduced motion, keyboard, and print behavior.

---

### Task 1: Lock the route and document-content contracts

**Files:**
- Modify: `server/legalRoutes.js`
- Modify: `server/legalRoutes.test.js`
- Create: `server/legalContent.test.js`

**Interfaces:**
- `renderLegalIndex()` continues to return a complete HTML document.
- Existing `GET /legal`, `/privacy`, `/terms`, `/support`, `/licenses`, `/acceptable-use`, and alias routes remain valid.

- [ ] **Step 1: Write failing route/content assertions**

Assert that each document has exactly one `h1`, a draft banner, `On this page`, stable section ids, no `COPY INJECTION` token, and the shared `LEGAL DESK` shell.

- [ ] **Step 2: Run the focused tests and confirm they fail**

Run: `node server/legalContent.test.js`

Expected: FAIL because the current documents still contain injection placeholders and do not expose the shared shell.

- [ ] **Step 3: Update the hub renderer and route compatibility**

Keep the existing aliases and cache headers. Make the hub list the full document set and keep `/acceptable-use` redirect-compatible while exposing the section anchor.

- [ ] **Step 4: Run focused route tests**

Run: `node server/legalRoutes.test.js && node server/legalContent.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```text
git add server/legalRoutes.js server/legalRoutes.test.js server/legalContent.test.js
git commit -m "test: define legal document content contracts"
```

### Task 2: Add the shared legal shell and responsive document CSS

**Files:**
- Modify: `public/styles.css`
- Modify: `public/clientResponsiveA11y.test.js`
- Create: `qa/legal-document-shell.spec.js`

**Interfaces:**
- `.legal-shell`, `.legal-header`, `.legal-document`, `.legal-outline`, `.legal-article`, `.legal-draft-banner`, and `.legal-related` are purely presentational classes.

- [ ] **Step 1: Add failing markup/CSS contracts**

Assert shell classes, 44px controls, article max-width, mobile outline behavior, forced-colors behavior, reduced-motion behavior, and print overrides.

- [ ] **Step 2: Run the focused tests and confirm they fail**

Run: `node public/clientResponsiveA11y.test.js && npx playwright test -c qa/playwright.config.js qa/legal-document-shell.spec.js --project=desktop-1920`

Expected: FAIL because the shell classes and responsive rules do not exist.

- [ ] **Step 3: Implement scoped CSS**

Reuse existing token roles, keep the footer ticker height, use a two-column document spread at desktop/tablet, switch to native disclosure navigation on mobile, and add reduced-motion/forced-colors/print rules.

- [ ] **Step 4: Run focused CSS/browser tests**

Run: `node public/clientResponsiveA11y.test.js && npx playwright test -c qa/playwright.config.js qa/legal-document-shell.spec.js --project=desktop-1920 --project=ipad-mini-landscape --project=mobile-390`

Expected: PASS.

- [ ] **Step 5: Commit**

```text
git add public/styles.css public/clientResponsiveA11y.test.js qa/legal-document-shell.spec.js
git commit -m "feat: add responsive Poorup legal document shell"
```

### Task 3: Replace Privacy and Terms placeholder pages with complete draft copy

**Files:**
- Modify: `public/legal/privacy.html`
- Modify: `public/legal/terms.html`
- Modify: `qa/legal-links.spec.js`

**Interfaces:**
- Pages remain standalone documents with the existing `/styles.css` dependency and no JavaScript requirement.

- [ ] **Step 1: Add failing copy assertions**

Assert the required section ids, draft status, no placeholder tokens, and explicit fictional-currency/no-real-money language.

- [ ] **Step 2: Run tests and confirm the expected failure**

Run: `node server/legalContent.test.js`

Expected: FAIL on placeholder tokens and missing sections.

- [ ] **Step 3: Write the complete draft documents**

Use plain language and clearly mark fact-dependent paragraphs (operator identity, legal bases, retention, jurisdiction, contact) as owner-review facts inside the draft banner and fact callouts. Do not make unsupported legal claims.

- [ ] **Step 4: Run focused tests**

Run: `node server/legalContent.test.js && npx playwright test -c qa/playwright.config.js qa/legal-links.spec.js --project=desktop-1920`

Expected: PASS.

- [ ] **Step 5: Commit**

```text
git add public/legal/privacy.html public/legal/terms.html qa/legal-links.spec.js
git commit -m "docs: add complete draft privacy and terms pages"
```

### Task 4: Add Acceptable Use, Support, Licenses, Accessibility, Storage, and AI notices

**Files:**
- Modify: `public/legal/support.html`
- Modify: `public/legal/licenses.html`
- Create: `public/legal/acceptable-use.html`
- Create: `public/legal/accessibility.html`
- Create: `public/legal/storage.html`
- Create: `public/legal/ai.html`
- Modify: `server/legalRoutes.js`
- Modify: `server/legalRoutes.test.js`

**Interfaces:**
- New documents use the same shell and static route pattern; existing `/acceptable-use` compatibility remains.

- [ ] **Step 1: Add failing route and copy tests**

Assert every new route resolves, has one `h1`, required headings, no placeholders, draft banner, and footer links.

- [ ] **Step 2: Run tests and confirm failure**

Run: `node server/legalRoutes.test.js && node server/legalContent.test.js`

Expected: FAIL because the new documents do not exist.

- [ ] **Step 3: Write complete draft notices**

Keep Support operational rather than contractual; keep Licenses factual and mark unapproved provenance; describe Storage/Telemetry and AI only in terms supported by the current code and explicitly flag provider/retention fields requiring confirmation.

- [ ] **Step 4: Run focused route/content tests**

Run: `node server/legalRoutes.test.js && node server/legalContent.test.js && npx playwright test -c qa/playwright.config.js qa/legal-links.spec.js --project=desktop-1920`

Expected: PASS.

- [ ] **Step 5: Commit**

```text
git add public/legal server/legalRoutes.js server/legalRoutes.test.js server/legalContent.test.js
git commit -m "docs: add complete draft support and policy notices"
```

### Task 5: Finish hub navigation, metadata, and accessibility QA

**Files:**
- Modify: `server/legalRoutes.js`
- Modify: `server/metadata.js`
- Modify: `server/metadata.test.js`
- Modify: `qa/legal-document-shell.spec.js`
- Modify: `qa/metadata.spec.js`

**Interfaces:**
- Private legal routes remain `noindex,nofollow` until an owner-approved canonical policy exists.
- Legal anchors focus headings without changing the game shell.

- [ ] **Step 1: Add failing metadata/keyboard assertions**

Cover document titles, robots policy, skip-link target, anchor focus, outside-click-free static navigation, and no horizontal overflow.

- [ ] **Step 2: Run tests and confirm failure**

Run: `node server/metadata.test.js && npx playwright test -c qa/playwright.config.js qa/legal-document-shell.spec.js --project=desktop-1920 --project=ipad-mini-landscape --project=mobile-390`

Expected: FAIL on new routes/shell assertions.

- [ ] **Step 3: Implement only legal-route metadata and semantic fixes**

Keep fail-closed origin behavior; add document-specific titles and preserve the existing global footer.

- [ ] **Step 4: Run the complete legal/browser checks**

Run: `node server/legalRoutes.test.js && node server/legalContent.test.js && node server/metadata.test.js && npx playwright test -c qa/playwright.config.js qa/legal-links.spec.js qa/legal-document-shell.spec.js qa/metadata.spec.js --project=desktop-1920 --project=ipad-mini-landscape --project=mobile-390`

Expected: PASS.

- [ ] **Step 5: Commit**

```text
git add server public/legal qa
git commit -m "test: verify legal navigation and metadata"
```

### Task 6: Full verification and evidence

**Files:**
- Modify: `docs/feature-status.json` only if route status changes are source-backed.
- Create: `qa-artifacts/legal-pages-1920/` (ignored visual evidence)

- [ ] **Step 1: Run server/client tests and lint**

Run: `npm test && npm run test:audit && npm run lint && npm run lint:client`

- [ ] **Step 2: Run browser matrix**

Run: `npx playwright test -c qa/playwright.config.js`

- [ ] **Step 3: Capture native evidence**

Capture hub, privacy, terms, acceptable use, support, licenses, accessibility, storage, and AI pages at 1920×1080; inspect every image at native resolution.

- [ ] **Step 4: Run Impeccable once on changed UI files**

Record degraded/parser status honestly if the local detector cannot load its parser modules.

- [ ] **Step 5: Run CodeScene only when `CS_ACCESS_TOKEN` is explicitly present**

Never print or persist the token. If absent, record the gate as blocked.

- [ ] **Step 6: Commit only verified source/docs changes**

Do not stage `.superpowers/sdd/.gitignore` or other internal ledger artifacts.
