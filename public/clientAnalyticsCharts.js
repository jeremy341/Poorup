const CHART_COLORS = Object.freeze({ line: '#CFA75F', bar: '#35A653', muted: '#5C5033' });

function finite(value) { const number = Number(value); return Number.isFinite(number) ? number : null; }
function escapeHtml(value) { return String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character])); }
function points(series) { if (!Array.isArray(series)) return []; return series.slice(0, 168).map((point, index) => ({ label: typeof point?.label === 'string' ? point.label.slice(0, 80) : String(index + 1), value: finite(point?.value ?? point?.y) })).filter(point => point.value !== null); }

export function renderAnalyticsChart(container, series, options = {}) {
  const values = points(series);
  if (!container || typeof document === 'undefined') return { values, table: true };
  const title = options.title || 'Analytics series'; const unit = options.unit || 'value'; const max = Math.max(1, ...values.map(point => Math.abs(point.value)));
  const path = values.map((point, index) => `${index ? 'L' : 'M'} ${Math.round(index * (100 / Math.max(1, values.length - 1)))} ${Math.round(50 - (point.value / max) * 45)}`).join(' ');
  container.innerHTML = `<figure class="analytics-chart"><figcaption>${escapeHtml(title)}</figcaption><svg viewBox="0 0 100 50" role="img" aria-label="${escapeHtml(title)}; ${values.length} observations" focusable="false"><path d="${path}" fill="none" stroke="${CHART_COLORS.line}" stroke-width="1" vector-effect="non-scaling-stroke"></path></svg><p class="t-micro ink-3">UNIT ${escapeHtml(unit)} · SAMPLE ${values.length}</p><button class="btn-dark analytics-chart-table-toggle" type="button">SHOW DATA TABLE</button><table class="analytics-chart-table is-hidden"><thead><tr><th scope="col">Label</th><th scope="col">${escapeHtml(unit)}</th></tr></thead><tbody>${values.map(point => `<tr><th scope="row">${escapeHtml(point.label)}</th><td>${escapeHtml(point.value)}</td></tr>`).join('')}</tbody></table></figure>`;
  const button = container.querySelector('.analytics-chart-table-toggle'); const table = container.querySelector('.analytics-chart-table');
  button?.addEventListener('click', () => { table?.classList.toggle('is-hidden'); button.textContent = table?.classList.contains('is-hidden') ? 'SHOW DATA TABLE' : 'HIDE DATA TABLE'; });
  return container.firstElementChild;
}

export { CHART_COLORS };
