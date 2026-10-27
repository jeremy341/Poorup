import assert from "node:assert/strict";
import process from "node:process";
import {
  normalizeChartSpec, layoutChart, chartSVG, chartMarkup, hoverMarkup, readoutText, nearestIndex, sparklineSVG,
  isHorizontal, preferredChartHeight, MAX_CHART_POINTS,
} from "./clientChartRender.js";

function check(name, assertion) {
  try {
    assertion();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}: ${error.message}`);
    process.exitCode = 1;
  }
}

const lineInput = (values, extra = {}) => ({ kind: "line", unit: "dollars", labels: values.map((_, index) => `R${index + 1}`), series: [{ id: "q", name: "Quote", values }], ...extra });
const modelOf = (input, size = { width: 400, height: 240 }) => {
  const spec = normalizeChartSpec(input);
  return { spec, model: layoutChart(spec, size) };
};

check("normalizeClampsSeriesPointsAndMarkersAndDropsNonFiniteValues", () => {
  const many = Array.from({ length: 200 }, (_, index) => index);
  const spec = normalizeChartSpec({
    kind: "nonsense", labels: many, unit: "x".repeat(60),
    series: Array.from({ length: 9 }, (_, index) => ({ name: `S${index}`, values: [1, "2", "bad", null, Infinity] })),
    markers: [{ index: 1, kind: "buy" }, { index: 999, kind: "buy" }, { index: -1 }, { index: 2, kind: "weird", label: "m".repeat(100) }],
  });
  assert.equal(spec.kind, "line");
  assert.equal(spec.labels.length, MAX_CHART_POINTS);
  assert.equal(spec.series.length, 6);
  assert.deepEqual(spec.series[0].raw.slice(0, 5), [1, 2, null, null, null]);
  assert.equal(spec.unit.length, 24);
  assert.equal(spec.markers.length, 2);
  assert.equal(spec.markers[1].kind, "note");
  assert.equal(spec.markers[1].label.length, 60);
});

check("normalizeScalesZeroToOneSharesToPercentButKeepsRawForReadouts", () => {
  const spec = normalizeChartSpec({ kind: "bar", unit: "percent", labels: ["a", "b"], series: [{ values: [0.08, 0.5] }] });
  assert.deepEqual(spec.series[0].values, [8, 50]);
  assert.deepEqual(spec.series[0].raw, [0.08, 0.5]);
  const already = normalizeChartSpec({ kind: "bar", unit: "percent", labels: ["a", "b"], series: [{ values: [8, 50] }] });
  assert.deepEqual(already.series[0].values, [8, 50], "values already above 1 are left alone");
});

check("lineLayoutMapsHigherValuesToSmallerYAndKeepsPointsInsideThePlot", () => {
  const { model } = modelOf(lineInput([80, 86, 92]));
  const [line] = model.lines;
  const ys = line.points.map(point => point.y);
  assert.ok(ys[0] > ys[1] && ys[1] > ys[2], "a rising series climbs up the chart");
  line.points.forEach(point => {
    assert.ok(point.x >= model.plot.x && point.x <= model.plot.x + model.plot.w);
    assert.ok(point.y >= model.plot.y && point.y <= model.plot.y + model.plot.h);
  });
  assert.deepEqual(model.xs, [...model.xs].sort((a, b) => a - b));
});

check("lineChartsHugTheDataButBarChartsAlwaysIncludeZero", () => {
  const line = modelOf(lineInput([80, 86, 92])).model;
  assert.ok(line.scale.min > 0, "a price trend is not squashed against a zero baseline");
  const bar = modelOf({ kind: "bar", unit: "matches", labels: ["a", "b"], series: [{ values: [80, 92] }] }).model;
  assert.equal(bar.scale.min, 0);
});

check("nullValuesBreakTheLineIntoSeparateSegments", () => {
  const { model } = modelOf(lineInput([1, 2, null, 4, 5]));
  assert.equal((model.lines[0].d.match(/M/g) || []).length, 2);
  assert.equal(model.lines[0].points[2], null);
});

check("aSinglePointCentersAndStillDraws", () => {
  const { model } = modelOf(lineInput([42]));
  assert.equal(model.xs.length, 1);
  assert.equal(model.xs[0], model.plot.x + model.plot.w / 2);
  const svg = chartMarkup(lineInput([42]));
  assert.match(svg, /class="pc-dot"/);
});

check("areaChartsAddAFilledPathUnderTheLine", () => {
  const { model } = modelOf(lineInput([1, 3, 2], { kind: "area" }));
  assert.match(model.lines[0].area, /Z$/);
  assert.match(chartMarkup(lineInput([1, 3, 2], { kind: "area" })), /class="pc-area"/);
  assert.doesNotMatch(chartMarkup(lineInput([1, 3, 2])), /pc-area/);
});

check("multiSeriesLinesAreToldApartByDashAndGetALegend", () => {
  const input = lineInput([1, 2, 3], { series: [{ id: "a", name: "Cash", values: [1, 2, 3] }, { id: "b", name: "Deeds", values: [3, 2, 1] }, { id: "c", name: "Debt", values: [2, 2, 2] }] });
  const { model } = modelOf(input);
  assert.equal(model.legend.length, 3);
  const dashes = model.lines.map(line => line.dash);
  assert.equal(new Set(dashes).size, 3, "no two series share a dash pattern");
  const svg = chartSVG(model, normalizeChartSpec(input));
  assert.match(svg, /class="pc-legend"/);
  assert.match(svg, /stroke-dasharray="7 4"/);
});

check("singleSeriesChartsShowNoLegend", () => {
  assert.doesNotMatch(chartMarkup(lineInput([1, 2, 3])), /pc-legend/);
});

check("barLayoutScalesHeightsInProportionAndHangsNegativesBelowZero", () => {
  const { model } = modelOf({ kind: "bar", unit: "matches", labels: ["a", "b", "c"], series: [{ values: [10, 5, -5] }] });
  const [big, half, negative] = model.bars;
  assert.ok(Math.abs(big.h / half.h - 2) < 0.01, "10 is twice as tall as 5");
  assert.equal(big.y + big.h, model.zeroPos, "positive bars stand on the zero line");
  assert.equal(negative.y, model.zeroPos, "negative bars hang from the zero line");
  assert.equal(model.horizontal, false);
});

check("manyOrLongLabelsSwitchBarsToHorizontalRows", () => {
  assert.equal(isHorizontal(normalizeChartSpec({ kind: "bar", labels: ["a", "b"], series: [{ values: [1, 2] }] })), false);
  assert.equal(isHorizontal(normalizeChartSpec({ kind: "bar", labels: ["openai / anthropic", "x"], series: [{ values: [1, 2] }] })), true);
  assert.equal(isHorizontal(normalizeChartSpec({ kind: "bar", labels: Array.from({ length: 8 }, (_, i) => String(i)), series: [{ values: [] }] })), true);
  assert.equal(isHorizontal(normalizeChartSpec({ kind: "bar", orientation: "vertical", labels: ["openai / anthropic"], series: [{ values: [1] }] })), false);
  assert.equal(isHorizontal(normalizeChartSpec({ kind: "line", labels: ["openai / anthropic"], series: [{ values: [1] }] })), false);
});

check("horizontalBarsTruncateLongRowLabelsButKeepTheFullNameAsATitle", () => {
  const long = "openai / a-very-long-provider-name-that-cannot-fit";
  const { model } = modelOf({ kind: "bar", unit: "matches", labels: [long, "b"], series: [{ values: [4, 2] }] }, { width: 300, height: 200 });
  assert.equal(model.horizontal, true);
  assert.ok(model.rowLabels[0].text.endsWith("…"));
  assert.equal(model.rowLabels[0].full, long);
  const svg = chartMarkup({ kind: "bar", unit: "matches", labels: [long, "b"], series: [{ values: [4, 2] }] }, { width: 300, height: 200 });
  assert.ok(svg.includes(`<title>${long}</title>`));
});

check("preferredHeightGrowsWithHorizontalRowsAndIsCapped", () => {
  const rows = count => preferredChartHeight(normalizeChartSpec({ kind: "bar", orientation: "horizontal", labels: Array.from({ length: count }, (_, i) => `row${i}`), series: [{ values: [] }] }));
  assert.ok(rows(10) > rows(3));
  assert.equal(rows(100), 540);
  assert.equal(preferredChartHeight(normalizeChartSpec(lineInput([1, 2]))), 240);
});

check("barValueLabelsAreShownForSmallSetsAndDroppedForCrowdedOnes", () => {
  const few = modelOf({ kind: "bar", unit: "matches", labels: ["a", "b", "c"], series: [{ values: [1, 2, 3] }], orientation: "vertical" }).model;
  assert.equal(few.valueLabels.length, 3);
  const crowded = modelOf({ kind: "bar", unit: "matches", labels: Array.from({ length: 40 }, (_, i) => `r${i}`), series: [{ values: Array.from({ length: 40 }, (_, i) => i) }], orientation: "vertical" }, { width: 400, height: 240 }).model;
  assert.equal(crowded.valueLabels.length, 0);
  const hidden = modelOf({ kind: "bar", unit: "matches", labels: ["a"], series: [{ values: [1] }], showValues: false }).model;
  assert.equal(hidden.valueLabels.length, 0);
});

check("markersGetDistinctShapesAndATitleSoColorIsNotTheOnlyCue", () => {
  const input = lineInput([80, 86, 92], { markers: [{ index: 0, kind: "buy", label: "YOUR BUY" }, { index: 1, kind: "sell", label: "YOUR SELL" }, { index: 2, kind: "event", label: "EVENT · boom" }] });
  const svg = chartMarkup(input);
  const shapes = [...svg.matchAll(/pc-marker pc-marker-(\w+)" data-i="\d"><path d="([^"]+)"/g)];
  assert.equal(shapes.length, 3);
  assert.equal(new Set(shapes.map(match => match[2])).size, 3, "buy, sell and event are different shapes");
  assert.match(svg, /R1 · YOUR BUY/);
  assert.match(svg, /R3 · EVENT · boom/);
});

check("svgIsLabelledAndEscapesEveryTextField", () => {
  const evil = '<img src=x onerror=alert(1)>';
  const svg = chartMarkup(lineInput([1, 2], { labels: [evil, "b"], series: [{ name: evil, values: [1, 2] }], markers: [{ index: 0, label: evil }] }), { label: evil, describedBy: "a\"b" });
  assert.match(svg, /role="img"/);
  assert.doesNotMatch(svg, /<img/);
  assert.doesNotMatch(svg, /onerror=alert\(1\)>/);
  assert.match(svg, /&lt;img/);
  assert.match(svg, /aria-describedby="a&quot;b"/);
});

check("emptyAndAllNullInputsRenderAHonestNoDataSvg", () => {
  assert.match(chartMarkup({ kind: "line", labels: [], series: [] }), /NO DATA/);
  const { model } = modelOf({ kind: "line", labels: ["a"], series: [] });
  assert.equal(model.empty, true);
  assert.equal(hoverMarkup(model, normalizeChartSpec({}), 0), "");
});

check("hoverMarkupShowsTheFormattedValueAndFlipsAtTheRightEdge", () => {
  const { spec, model } = modelOf(lineInput([80, 86, 92]));
  const first = hoverMarkup(model, spec, 0);
  assert.match(first, /class="pc-cursor"/);
  assert.match(first, /R1/);
  assert.match(first, /\$80/);
  const lastIndex = spec.labels.length - 1;
  const last = hoverMarkup(model, spec, lastIndex);
  const boxX = Number(last.match(/<g class="pc-readout"><rect x="([\d.]+)"/)[1]);
  const boxW = Number(last.match(/<g class="pc-readout"><rect x="[\d.]+" y="[\d.]+" width="([\d.]+)"/)[1]);
  assert.ok(boxX + boxW <= model.width - 4 + 0.01, "the readout box stays inside the chart");
  assert.equal(hoverMarkup(model, spec, 99), "");
  assert.equal(hoverMarkup(model, spec, -1), "");
});

check("hoverMarkupListsEverySeriesAndMarkerNotes", () => {
  const input = lineInput([1, 2], { series: [{ name: "Cash", values: [1, 2] }, { name: "Deeds", values: [3, 4] }], markers: [{ index: 1, kind: "event", label: "Tax holiday" }] });
  const { spec, model } = modelOf(input);
  const markup = hoverMarkup(model, spec, 1);
  assert.match(markup, /Cash: /);
  assert.match(markup, /Deeds: /);
  assert.match(markup, /Tax holiday/);
  assert.match(readoutText(spec, 1), /R2, Cash .*Deeds .*Tax holiday/);
  assert.equal(readoutText(spec, 9), "");
});

check("nearestIndexUsesTheCategoryAxisOfEachChartType", () => {
  const { model } = modelOf(lineInput([1, 2, 3]));
  assert.equal(nearestIndex(model, model.xs[2] + 3, 0), 2);
  assert.equal(nearestIndex(model, -50, 0), 0);
  const rows = modelOf({ kind: "bar", unit: "matches", orientation: "horizontal", labels: ["a", "b", "c"], series: [{ values: [1, 2, 3] }] }).model;
  assert.equal(rows.axis, "y");
  assert.equal(nearestIndex(rows, 0, rows.ys[1] + 2), 1);
  assert.equal(nearestIndex({ axis: "x", xs: [] }, 0, 0), -1);
});

check("sparklineDrawsATrendEndsOnADotAndIsEmptyForTooFewPoints", () => {
  const svg = sparklineSVG([1, 3, 2, 5], { label: "Cash trend" });
  assert.match(svg, /<path class="pc-line" d="M/);
  assert.match(svg, /class="pc-dot"/);
  assert.match(svg, /aria-label="Cash trend"/);
  assert.doesNotMatch(sparklineSVG([1]), /pc-line/);
  assert.doesNotMatch(sparklineSVG("nope"), /pc-line/);
  assert.match(sparklineSVG([2, 2, 2]), /pc-line/, "a flat trend still draws");
  assert.match(sparklineSVG([1, 2], { tone: "bogus" }), /pc-tone-primary/);
});

check("layoutNeverProducesNaNGeometry", () => {
  const cases = [lineInput([1, 1, 1]), lineInput([0, 0]), lineInput([-5, 5]), lineInput([null, null]), { kind: "bar", unit: "percent", labels: ["a", "b"], series: [{ values: [0, 0] }] }];
  for (const input of cases) {
    const svg = chartMarkup(input, { width: 160, height: 120 });
    assert.doesNotMatch(svg, /NaN|Infinity|undefined/, JSON.stringify(input));
  }
});

check("theSvgRootClassNeverCollidesWithAnElementStyleClass", () => {
  for (const kind of ["line", "area", "bar"]) {
    const svg = chartMarkup({ kind, unit: "dollars", labels: ["a", "b"], series: [{ values: [1, 2] }] });
    const root = svg.match(/^<svg class="([^"]+)"/)[1].split(" ");
    assert.deepEqual(root, ["pc-svg", `pc-kind-${kind}`]);
    for (const reserved of ["pc-area", "pc-line", "pc-bar", "pc-dot"]) assert.ok(!root.includes(reserved), `${reserved} is an element class, and its inherited fill/stroke would leak into every label`);
  }
});

check("aMoneyLineNeverGetsANegativeAxisTick", () => {
  const spec = normalizeChartSpec({ kind: "line", unit: "dollars", labels: ["R1", "R2", "R3"], series: [{ name: "Cash", values: [1500, 2100, 210] }, { name: "Rival", values: [1400, 900, 600] }] });
  const model = layoutChart(spec, { width: 460, height: 170 });
  assert.ok(model.scale.min >= 0, `axis starts at ${model.scale.min}`);
  assert.ok(model.yTicks.every(tick => !tick.label.includes("-")), "no tick reads as a negative amount");
  assert.ok(model.yTicks.some(tick => tick.label === "$0"));
  const signed = layoutChart(normalizeChartSpec({ kind: "line", unit: "dollars", labels: ["a", "b"], series: [{ values: [-40, 60] }] }), { width: 400, height: 240 });
  assert.ok(signed.scale.min < 0, "signed data still shows its negative range");
});

check("aPercentLineStaysWithinZeroToOneHundred", () => {
  const spec = normalizeChartSpec({ kind: "line", unit: "percent", labels: ["a", "b", "c"], series: [{ values: [0.62, 0.97, 0.9] }] });
  const model = layoutChart(spec, { width: 400, height: 240 });
  assert.ok(model.scale.max <= 100 && model.scale.min >= 0);
});

check("percentBarsAreMeasuredAgainstOneHundredPercentInBothOrientations", () => {
  const input = { kind: "bar", unit: "percent", labels: ["Reconnect rate", "AFK rate"], series: [{ values: [0.08, 0.02] }] };
  for (const orientation of ["horizontal", "vertical"]) {
    const model = layoutChart(normalizeChartSpec({ ...input, orientation }), { width: 600, height: 300 });
    assert.equal(model.scale.min, 0);
    assert.equal(model.scale.max, 100, `${orientation} bars span the whole share`);
    const [reconnect, afk] = model.bars;
    const size = bar => (orientation === "horizontal" ? bar.w : bar.h);
    const full = orientation === "horizontal" ? model.plot.w : model.plot.h;
    assert.ok(size(reconnect) < full * 0.12, "an 8% rate is a short bar, not a full one");
    assert.ok(Math.abs(size(reconnect) / size(afk) - 4) < 0.05, "8% is still four times 2%");
  }
  const counts = layoutChart(normalizeChartSpec({ kind: "bar", unit: "matches", labels: ["a", "b"], series: [{ values: [3, 8] }] }), { width: 400, height: 240 });
  assert.equal(counts.scale.max, 8, "counts still scale to their own data");
});
