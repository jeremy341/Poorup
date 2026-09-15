const FALLBACK_TOKENS = Object.freeze({
  primary: 'var(--analytics-primary)',
  comparison: 'var(--analytics-comparison)',
  human: 'var(--analytics-human)',
  ai: 'var(--analytics-ai)',
  bot: 'var(--analytics-bot)',
  positive: 'var(--analytics-positive)',
  negative: 'var(--analytics-negative)',
  warning: 'var(--analytics-warning)',
  neutral: 'var(--analytics-neutral)',
  grid: 'var(--analytics-grid)',
  surface: 'var(--surface-panel)',
  surfaceDeep: 'var(--surface-panel-deep)',
  text: 'var(--text-muted)',
  textPrimary: 'var(--text-primary)',
  focus: 'var(--gold-050)'
});

const TOKEN_NAMES = Object.freeze({
  primary: '--analytics-primary',
  comparison: '--analytics-comparison',
  human: '--analytics-human',
  ai: '--analytics-ai',
  bot: '--analytics-bot',
  positive: '--analytics-positive',
  negative: '--analytics-negative',
  warning: '--analytics-warning',
  neutral: '--analytics-neutral',
  grid: '--analytics-grid',
  surface: '--surface-panel',
  surfaceDeep: '--surface-panel-deep',
  text: '--text-muted',
  textPrimary: '--text-primary',
  focus: '--gold-050'
});

function readToken(element, name, fallback) {
  const getter = globalThis.getComputedStyle;
  if (typeof getter !== 'function' || !element) return fallback;
  const value = getter(element).getPropertyValue(name).trim();
  return value || fallback;
}

export function resolvePoorupChartTokens(element = globalThis.document?.documentElement) {
  return Object.freeze(Object.fromEntries(Object.entries(TOKEN_NAMES).map(([key, name]) => [key, readToken(element, name, FALLBACK_TOKENS[key])] )));
}

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function formatChartValue(value, unit) {
  const number = finite(value);
  if (number === null) return 'N/A';
  const normalized = String(unit || '').toLowerCase();
  if (normalized === 'percent' || normalized === 'adoption' || normalized.endsWith('rate')) return `${(Math.abs(number) <= 1 ? number * 100 : number).toLocaleString(undefined, { maximumFractionDigits: 1 })}%`;
  return number.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function cleanPoints(points) {
  if (!Array.isArray(points)) return [];
  return points.slice(0, 168).map((point, index) => ({
    label: typeof point?.label === 'string' ? point.label.slice(0, 80) : String(index + 1),
    value: finite(point?.value ?? point?.y),
    values: point?.values && typeof point.values === 'object' && !Array.isArray(point.values) ? point.values : null,
    series: typeof point?.series === 'string' ? point.series.slice(0, 40) : '',
    unit: typeof point?.unit === 'string' ? point.unit.slice(0, 24) : ''
  })).filter(point => point.value !== null || point.values);
}

function groupedPoints(points) {
  const groups = new Map();
  points.forEach(point => {
    const key = point.series || 'verified';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(point);
  });
  return [...groups.entries()].map(([name, values]) => ({ name, values }));
}

function labelForSeries(name) { return name === 'verified' ? 'Verified' : name; }

function palette(tokens) {
  return [tokens.primary, tokens.comparison, tokens.human, tokens.ai, tokens.bot, tokens.positive, tokens.warning, tokens.negative];
}

function commonOptions(tokens, title, reducedMotion) {
  return {
    animation: reducedMotion ? false : false,
    animationDuration: 0,
    animationDurationUpdate: 0,
    color: palette(tokens),
    aria: { show: true, decal: { show: false } },
    textStyle: { fontFamily: 'Silkscreen, Courier New, monospace', color: tokens.text },
    tooltip: {
      trigger: 'axis',
      confine: true,
      backgroundColor: tokens.surfaceDeep,
      borderColor: tokens.focus,
      borderWidth: 1,
      textStyle: { color: tokens.textPrimary, fontFamily: 'Pixelify Sans, Courier New, monospace' },
      extraCssText: 'box-shadow: none; border-radius: 0;'
    },
    legend: {
      type: 'scroll',
      top: 0,
      left: 0,
      textStyle: { color: tokens.text, fontFamily: 'Silkscreen, Courier New, monospace', fontSize: 11 },
      pageTextStyle: { color: tokens.text }
    },
    grid: { left: 82, right: 20, top: 34, bottom: 40, containLabel: true },
    title: { show: false, text: title }
  };
}

function axis(tokens, unit, horizontal = false) {
  const base = {
    axisLine: { lineStyle: { color: tokens.grid, width: 1 } },
    axisTick: { show: false },
    axisLabel: { color: tokens.text, fontFamily: 'Silkscreen, Courier New, monospace', fontSize: 11, hideOverlap: true, ...(horizontal ? { formatter: value => formatChartValue(value, unit) } : {}) },
    splitLine: { lineStyle: { color: tokens.grid, width: 1, opacity: 0.7 } },
    name: String(unit || 'VALUE').toUpperCase(),
    nameTextStyle: { color: tokens.primary, fontFamily: 'Silkscreen, Courier New, monospace', fontSize: 11 },
    nameGap: 18
  };
  return horizontal ? { ...base, type: 'value', position: 'bottom' } : { ...base, type: 'category' };
}

function numericAxis(tokens, unit) {
  return { ...axis(tokens, unit, true), min: 0, nameLocation: 'end' };
}

function lineOptions(points, unit, tokens, title, reducedMotion) {
  const labels = [...new Set(points.map(point => point.label))];
  const groups = groupedPoints(points);
  return {
    ...commonOptions(tokens, title, reducedMotion),
    grid: { left: 70, right: 20, top: 52, bottom: 42, containLabel: true },
    xAxis: { ...axis(tokens, '', false), data: labels, boundaryGap: false },
    yAxis: { ...numericAxis(tokens, unit), nameGap: 42 },
    series: groups.map((group, index) => ({
      name: labelForSeries(group.name),
      type: 'line',
      data: labels.map(label => group.values.find(point => point.label === label)?.value ?? null),
      connectNulls: false,
      showSymbol: true,
      symbol: 'rect',
      symbolSize: 7,
      smooth: false,
      lineStyle: { width: 2, color: palette(tokens)[index % palette(tokens).length] },
      itemStyle: { color: palette(tokens)[index % palette(tokens).length], borderColor: tokens.focus, borderWidth: 1 },
      areaStyle: { color: palette(tokens)[index % palette(tokens).length], opacity: 0.14 }
    }))
  };
}

function barOptions(points, unit, tokens, title, reducedMotion) {
  const unitGroups = new Map();
  points.forEach(point => {
    const groupUnit = point.unit || unit || 'value';
    if (!unitGroups.has(groupUnit)) unitGroups.set(groupUnit, []);
    unitGroups.get(groupUnit).push(point);
  });
  const groups = [...unitGroups.entries()];
  const paletteValues = palette(tokens);
  const axes = groups.map(([groupUnit, groupPoints], index) => {
    const labels = groupPoints.map(point => point.label);
    return {
      groupUnit,
      labels,
      xAxis: { ...numericAxis(tokens, groupUnit), gridIndex: index },
      yAxis: { ...axis(tokens, groupUnit, false), data: labels, inverse: true, gridIndex: index },
      series: {
        name: groups.length > 1 ? String(groupUnit).toUpperCase() : 'Verified',
        type: 'bar',
        xAxisIndex: index,
        yAxisIndex: index,
        barMaxWidth: 16,
        barGap: '12%',
        data: groupPoints.map(point => point.value),
        itemStyle: { color: paletteValues[index % paletteValues.length], borderColor: tokens.surfaceDeep, borderWidth: 1, borderRadius: 0 },
        label: { show: true, position: 'right', color: tokens.primary, fontFamily: 'Silkscreen, Courier New, monospace', fontSize: 11, formatter: params => formatChartValue(params.value, groupUnit) }
      }
    };
  });
  const grids = groups.map((_, index) => groups.length === 1
    ? { left: 150, right: 48, top: 36, bottom: 40, containLabel: true }
    : { left: 150, right: 48, top: `${34 + index * (62 / groups.length)}%`, height: `${Math.max(20, Math.floor(52 / groups.length))}%`, containLabel: true });
  return {
    ...commonOptions(tokens, title, reducedMotion),
    grid: grids,
    xAxis: axes.map(axisValue => axisValue.xAxis),
    yAxis: axes.map(axisValue => axisValue.yAxis),
    series: axes.map(axisValue => axisValue.series),
    legend: groups.length > 1 ? { ...commonOptions(tokens, title, reducedMotion).legend, data: axes.map(axisValue => axisValue.series.name) } : commonOptions(tokens, title, reducedMotion).legend
  };
}

function stackedOptions(points, unit, tokens, title, reducedMotion) {
  const labels = points.map(point => point.label);
  const keys = [...new Set(points.flatMap(point => Object.keys(point.values || {})))].filter(key => Object.hasOwn(tokens, key)).slice(0, 8);
  const groups = keys.length ? keys : ['primary'];
  const paletteValues = palette(tokens);
  return {
    ...commonOptions(tokens, title, reducedMotion),
    grid: { left: 70, right: 20, top: 40, bottom: 42, containLabel: true },
    xAxis: { ...axis(tokens, '', false), data: labels },
    yAxis: numericAxis(tokens, unit),
    series: groups.map((key, index) => ({
      name: key,
      type: 'bar',
      stack: 'total',
      barMaxWidth: 22,
      data: points.map(point => finite(point.values?.[key])),
      itemStyle: { color: tokens[key] || paletteValues[index % paletteValues.length], borderColor: tokens.surfaceDeep, borderWidth: 1, borderRadius: 0 }
    }))
  };
}

function heatmapOptions(points, unit, tokens, title, reducedMotion, cohort = false, boardColumns = 0) {
  const columns = boardColumns || (cohort ? 12 : 14);
  const rows = Math.max(1, Math.ceil(points.length / columns));
  const values = points.map(point => Math.abs(finite(point.value) ?? 0));
  const max = Math.max(1, ...values);
  return {
    ...commonOptions(tokens, title, reducedMotion),
    grid: { left: 46, right: 20, top: 40, bottom: 42, containLabel: true },
    visualMap: { min: 0, max, show: true, orient: 'horizontal', left: 'center', bottom: 4, textStyle: { color: tokens.text, fontFamily: 'Silkscreen, Courier New, monospace', fontSize: 10 }, inRange: { color: [tokens.surfaceDeep, tokens.warning] } },
    xAxis: { type: 'category', data: Array.from({ length: columns }, (_, index) => String(index + 1)), axisLabel: { show: false }, splitArea: { show: false }, axisLine: { lineStyle: { color: tokens.grid } } },
    yAxis: { type: 'category', data: Array.from({ length: rows }, (_, index) => String(index + 1)), axisLabel: { show: false }, axisLine: { lineStyle: { color: tokens.grid } } },
    series: [{ name: String(unit || 'OBSERVATIONS').toUpperCase(), type: 'heatmap', data: points.map((point, index) => [index % columns, Math.floor(index / columns), finite(point.value) ?? 0]), itemStyle: { borderColor: tokens.surfaceDeep, borderWidth: 1 } }]
  };
}

function histogramOptions(points, unit, tokens, title, reducedMotion) {
  const values = points.map(point => finite(point.value)).filter(value => value !== null);
  const bins = Math.min(12, Math.max(1, values.length));
  const min = values.length ? Math.min(...values) : 0;
  const max = values.length ? Math.max(...values) : 1;
  const span = Math.max(1, max - min);
  const buckets = Array.from({ length: bins }, () => 0);
  values.forEach(value => { buckets[Math.min(bins - 1, Math.max(0, Math.floor(((value - min) / span) * bins)))] += 1; });
  return {
    ...commonOptions(tokens, title, reducedMotion),
    xAxis: { ...axis(tokens, unit, false), data: buckets.map((_, index) => `${index + 1}`) },
    yAxis: numericAxis(tokens, 'observations'),
    series: [{ name: 'Distribution', type: 'bar', data: buckets, barMaxWidth: 28, itemStyle: { color: tokens.primary, borderColor: tokens.surfaceDeep, borderWidth: 1, borderRadius: 0 } }]
  };
}

function boxOptions(points, unit, tokens, title, reducedMotion) {
  const values = points.map(point => finite(point.value)).filter(value => value !== null).sort((a, b) => a - b);
  const percentile = fraction => values.length ? values[Math.floor((values.length - 1) * fraction)] : 0;
  return {
    ...commonOptions(tokens, title, reducedMotion),
    xAxis: { ...axis(tokens, unit, false), data: ['Verified'] },
    yAxis: numericAxis(tokens, unit),
    series: [{ name: 'Verified', type: 'boxplot', data: [[percentile(0), percentile(.25), percentile(.5), percentile(.75), percentile(1)]], itemStyle: { color: tokens.comparison, borderColor: tokens.focus, borderWidth: 1 } }]
  };
}

function scatterOptions(points, unit, tokens, title, reducedMotion) {
  return {
    ...commonOptions(tokens, title, reducedMotion),
    xAxis: { ...axis(tokens, '', false), data: points.map(point => point.label) },
    yAxis: numericAxis(tokens, unit),
    series: [{ name: 'Verified', type: 'scatter', symbol: 'rect', symbolSize: 8, data: points.map((point, index) => [index, point.value]), itemStyle: { color: tokens.primary, borderColor: tokens.focus, borderWidth: 1 } }]
  };
}

function funnelOptions(points, unit, tokens, title, reducedMotion) {
  return {
    ...commonOptions(tokens, title, reducedMotion),
    tooltip: { ...commonOptions(tokens, title, reducedMotion).tooltip, trigger: 'item' },
    legend: { ...commonOptions(tokens, title, reducedMotion).legend, bottom: 0, top: 'auto' },
    series: [{ name: String(unit || 'FUNNEL').toUpperCase(), type: 'funnel', left: 50, right: 50, top: 36, bottom: 26, min: 0, max: Math.max(1, ...points.map(point => point.value ?? 0)), minSize: '12%', maxSize: '88%', sort: 'descending', gap: 4, label: { color: tokens.textPrimary, fontFamily: 'Silkscreen, Courier New, monospace', fontSize: 11 }, itemStyle: { borderColor: tokens.surfaceDeep, borderWidth: 1 }, data: points.map(point => ({ name: point.label, value: point.value })) }]
  };
}

function boardOptions(points, unit, tokens, title, reducedMotion, variant = 'standard-40') {
  const columns = String(variant).toLowerCase() === 'metro-52' ? 13 : 10;
  return heatmapOptions(points, unit, tokens, title, reducedMotion, false, columns);
}

const OPTION_BUILDERS = Object.freeze({
  line: lineOptions,
  bar: barOptions,
  'stacked-bar': stackedOptions,
  heatmap: (points, unit, tokens, title, reducedMotion) => heatmapOptions(points, unit, tokens, title, reducedMotion, false),
  cohort: (points, unit, tokens, title, reducedMotion) => heatmapOptions(points, unit, tokens, title, reducedMotion, true),
  histogram: histogramOptions,
  box: boxOptions,
  scatter: scatterOptions,
  funnel: funnelOptions,
  board: (points, unit, tokens, title, reducedMotion, options) => boardOptions(points, unit, tokens, title, reducedMotion, options.variant)
});

export function createPoorupChartOptions(points, { mode = 'line', unit = 'value', title = 'Analytics series', tokens = resolvePoorupChartTokens(), reducedMotion = false, variant = 'standard-40' } = {}) {
  const clean = cleanPoints(points);
  const normalizedMode = String(mode).toLowerCase();
  const builder = OPTION_BUILDERS[normalizedMode] || barOptions;
  return builder(clean, unit, tokens, title, reducedMotion, { variant });
}

export { FALLBACK_TOKENS };
