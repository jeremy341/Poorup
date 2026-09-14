const CHART_COLORS = Object.freeze({ line: '#CFA75F', bar: '#35A653', muted: '#5C5033' });
let chartSequence = 0;

function finite(value) { const number = Number(value); return Number.isFinite(number) ? number : null; }
function escapeHtml(value) { return String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character])); }
function mediaMatches(query) { const media = globalThis.matchMedia || globalThis.window?.matchMedia; return typeof media === 'function' && media.call(globalThis, query)?.matches === true; }
function points(series) { if (!Array.isArray(series)) return []; return series.slice(0, 168).map((point, index) => ({ label: typeof point?.label === 'string' ? point.label.slice(0, 80) : String(index + 1), value: finite(point?.value ?? point?.y) })).filter(point => point.value !== null); }

export function renderAnalyticsChart(container, series, options = {}) {
  const values = points(series);
  if (!container || typeof document === 'undefined') return { values, table: true };
  const title = options.title || 'Analytics series'; const unit = options.unit || 'value'; const max = Math.max(1, ...values.map(point => Math.abs(point.value)));
  const path = values.map((point, index) => `${index ? 'L' : 'M'} ${Math.round(index * (100 / Math.max(1, values.length - 1)))} ${Math.max(5, Math.min(50, Math.round(50 - (point.value / max) * 45)))}`).join(' ');
  const reducedMotion = mediaMatches('(prefers-reduced-motion: reduce)');
  const bars = options.mode === 'bar' ? values.map((point, index) => { const height = Math.round((Math.abs(point.value) / max) * 45); const y = point.value >= 0 ? 50 - height : 50; return `<rect x="${Math.round(index * (100 / Math.max(1, values.length)))}" y="${y}" width="${Math.max(1, Math.round(90 / Math.max(1, values.length)))}" height="${Math.max(0, height)}" fill="${CHART_COLORS.bar}"></rect>`; }).join('') : '';
  const forcedColors = mediaMatches('(forced-colors: active)');
  const tableId = `analytics-chart-table-${++chartSequence}`;
  const svgAttributes = forcedColors ? ' hidden aria-hidden="true"' : '';
  const tableClass = forcedColors ? 'analytics-chart-table' : 'analytics-chart-table is-hidden';
  container.innerHTML = `<figure class="analytics-chart" data-motion="${reducedMotion ? 'reduced' : 'standard'}" data-animation="${reducedMotion ? 'none' : 'draw'}" data-forced-colors="${forcedColors ? 'active' : 'off'}"><figcaption>${escapeHtml(title)}</figcaption><svg${svgAttributes} viewBox="0 0 100 50" role="img" aria-label="${escapeHtml(title)}; ${values.length} observations" focusable="false"><text x="0" y="7">MAX</text><text x="0" y="49">0</text>${bars || `<path d="${path}" fill="none" stroke="${CHART_COLORS.line}" stroke-width="1" vector-effect="non-scaling-stroke"></path>`}<text x="50" y="50">TIME</text></svg><p class="t-micro ink-3">UNIT ${escapeHtml(unit)} · SAMPLE ${values.length}</p><button class="btn-dark analytics-chart-table-toggle" type="button" aria-expanded="${forcedColors ? 'true' : 'false'}" aria-controls="${tableId}">${forcedColors ? 'HIDE DATA TABLE' : 'SHOW DATA TABLE'}</button><table class="${tableClass}" id="${tableId}"><caption>${escapeHtml(title)} data table</caption><thead><tr><th scope="col">Label</th><th scope="col">${escapeHtml(unit)}</th></tr></thead><tbody>${values.map(point => `<tr><th scope="row">${escapeHtml(point.label)}</th><td>${escapeHtml(point.value)}</td></tr>`).join('')}</tbody></table></figure>`;
  const button = container.querySelector('.analytics-chart-table-toggle'); const table = container.querySelector('.analytics-chart-table');
  button?.addEventListener('click', () => { table?.classList.toggle('is-hidden'); const expanded = !table?.classList.contains('is-hidden'); button.setAttribute('aria-expanded', String(expanded)); button.textContent = expanded ? 'HIDE DATA TABLE' : 'SHOW DATA TABLE'; });
  return container.firstElementChild;
}

export { CHART_COLORS };
