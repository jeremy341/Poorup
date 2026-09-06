/* ============================================================
   DOM UTILITIES
   ============================================================ */
export function $(sel) {
  return document.querySelector(sel);
}

export function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

export const REDUCED_MOTION = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches || false;
