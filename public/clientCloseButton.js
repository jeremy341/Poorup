import { esc } from './clientDom.js';

export function closeButtonHTML({ id, label, className = '' }) {
  if (typeof id !== 'string' || !id.trim() || typeof label !== 'string' || !label.trim()) {
    throw new TypeError('A close button needs an id and an accessible label.');
  }
  const classes = ['btn-dark', 'surface-close', className].filter(Boolean).join(' ');
  return `<button class="${esc(classes)}" id="${esc(id)}" type="button" aria-label="${esc(label)}" title="${esc(label)}"><svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true" focusable="false"><use href="#ui-close"/></svg></button>`;
}
