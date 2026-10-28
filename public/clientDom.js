// DOM UTILITIES
export function $(sel) {
  return document.querySelector(sel);
}

export function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// Render passes rebuild the same markup many times a second. Rewriting identical markup destroys and
// re-parses the subtree and resets scroll and focus inside it, so a pass can skip the write when this
// element still holds exactly what this helper wrote last. Returns true when the element was written.
const writtenMarkup = new WeakMap();
// Controls left mid-action by the rail handlers (pending buttons, appended status lines) are mutated in
// place; their next render must still rebuild the markup so they reset completely.
const IN_PLACE_MUTATION_SELECTOR = '[data-pending], [aria-busy="true"], .action-status';

export function setHtml(el, html) {
  if (!el) return false;
  const markup = String(html);
  const last = writtenMarkup.get(el);
  // The first/last child check notices a direct innerHTML write made around this helper.
  const unchanged = last
    ? last.markup === markup && last.first === el.firstChild && last.last === el.lastChild && !el.querySelector(IN_PLACE_MUTATION_SELECTOR)
    : markup === "" && !el.firstChild;
  if (unchanged) {
    if (!last) writtenMarkup.set(el, { markup, first: null, last: null });
    return false;
  }
  el.innerHTML = markup;
  writtenMarkup.set(el, { markup, first: el.firstChild, last: el.lastChild });
  return true;
}

// Assigning textContent always replaces the text node and invalidates layout, even with the same text.
// Renders that repeat the same label every pass use this to write only when the text really changed.
export function setText(el, text) {
  if (!el) return false;
  const value = String(text);
  const child = el.firstChild;
  const unchanged = child
    ? child.nodeType === 3 && !child.nextSibling && child.data === value
    : value === "";
  if (unchanged) return false;
  el.textContent = value;
  return true;
}

// An exported `let` is a live binding, so every importer sees the current preference.
const reducedMotionQuery = window.matchMedia?.("(prefers-reduced-motion: reduce)");
export let REDUCED_MOTION = reducedMotionQuery?.matches || false;
const onReducedMotionChange = (event) => { REDUCED_MOTION = Boolean(event?.matches); };
if (reducedMotionQuery?.addEventListener) reducedMotionQuery.addEventListener("change", onReducedMotionChange);
else reducedMotionQuery?.addListener?.(onReducedMotionChange);

export const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
