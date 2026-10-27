import assert from "node:assert/strict";
import process from "node:process";
import {
  finite, clamp, niceStep, niceScale, naturalLimits, barDomain, linearScale, visibleLabelIndices, truncateLabel, unitKind, formatValue, formatTick,
} from "./clientChartMath.js";

function check(name, assertion) {
  try {
    assertion();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}: ${error.message}`);
    process.exitCode = 1;
  }
}

// Number text follows the system locale (like the rest of the app), so compare with separators removed.
const bare = text => text.replace(/[\s.,]/g, "");

check("finiteTreatsNullAndBlankAsMissingNotZero", () => {
  assert.equal(finite(null), null);
  assert.equal(finite(undefined), null);
  assert.equal(finite(""), null);
  assert.equal(finite("abc"), null);
  assert.equal(finite(Infinity), null);
  assert.equal(finite("12"), 12);
  assert.equal(finite(0), 0);
});

check("niceStepPicksOneTwoFiveSteps", () => {
  assert.equal(niceStep(10, 5), 2);
  assert.equal(niceStep(100, 5), 20);
  assert.equal(niceStep(0.5, 5), 0.1);
  assert.equal(niceStep(0), 1);
  assert.equal(niceStep(-4), 1);
});

check("niceScaleHugsDataWithPaddingWhenZeroIsNotRequired", () => {
  const scale = niceScale([80, 86, 92], { pad: 0.1 });
  assert.deepEqual(scale.ticks, [75, 80, 85, 90, 95]);
  assert.equal(scale.min, 75);
  assert.equal(scale.max, 95);
});

check("niceScaleKeepsZeroForBarsAndNeverReturnsAnEmptyDomain", () => {
  assert.deepEqual(niceScale([3, 7], { zero: true }).ticks, [0, 2, 4, 6, 8]);
  const allZero = niceScale([0, 0], { zero: true });
  assert.equal(allZero.min, 0);
  assert.ok(allZero.max > 0);
  const flat = niceScale([5, 5]);
  assert.ok(flat.min < 5 && flat.max > 5, "a flat series still gets a visible band");
  const empty = niceScale([null, undefined]);
  assert.ok(empty.max > empty.min);
});

check("niceScaleCoversNegativesAndIncludesTheZeroTick", () => {
  const scale = niceScale([-5, 10], { zero: true });
  assert.ok(scale.min <= -5 && scale.max >= 10);
  assert.ok(scale.ticks.includes(0));
  assert.deepEqual(scale.ticks, [...scale.ticks].sort((a, b) => a - b));
});

check("linearScaleMapsAndInvertsRanges", () => {
  const up = linearScale(0, 10, 0, 100);
  assert.equal(up(5), 50);
  const flipped = linearScale(0, 10, 100, 0);
  assert.equal(flipped(0), 100);
  assert.equal(flipped(10), 0);
  assert.ok(Number.isFinite(linearScale(3, 3, 0, 10)(3)), "a zero-width domain does not divide by zero");
});

check("visibleLabelIndicesThinsCrowdedAxesAndKeepsTheFirstLabel", () => {
  const labels = Array.from({ length: 12 }, (_, index) => `R${index + 1}`);
  assert.equal(visibleLabelIndices(labels, 100).length, 12, "roomy axes show every label");
  const crowded = visibleLabelIndices(labels, 10);
  assert.equal(crowded[0], 0);
  assert.ok(crowded.length < labels.length);
  const gaps = crowded.slice(1).map((value, index) => value - crowded[index]);
  assert.ok(gaps.every(gap => gap >= gaps[0] || gap === labels.length - 1 - crowded[crowded.length - 2]));
  assert.deepEqual(visibleLabelIndices([], 50), []);
});

check("visibleLabelIndicesAddsTheLastLabelOnlyWhenThereIsRoom", () => {
  const labels = ["a", "b", "c", "d", "e"];
  assert.equal(visibleLabelIndices(labels, 30).at(-1), 4);
  const tight = visibleLabelIndices(["wwwwwwww", "x", "y", "z"], 20);
  assert.equal(tight[0], 0);
});

check("truncateLabelEndsWithAnEllipsisAndLeavesShortTextAlone", () => {
  assert.equal(truncateLabel("short", 10), "short");
  assert.equal(truncateLabel("a very long label", 8), "a very …");
  assert.equal(truncateLabel("abc", 1), "abc");
  assert.equal(truncateLabel(null, 5), "");
});

check("unitKindRecognisesSharesMoneyAndDurations", () => {
  assert.equal(unitKind("percent"), "percent");
  assert.equal(unitKind("adoption"), "percent");
  assert.equal(unitKind("completionRate"), "percent");
  assert.equal(unitKind("dollars"), "money");
  assert.equal(unitKind("seconds"), "seconds");
  assert.equal(unitKind("matches"), "number");
});

check("formatValueReadsSharesAsPercentagesAndMoneyWithASign", () => {
  assert.equal(formatValue(0.08, "percent"), "8%");
  assert.equal(formatValue(42, "adoption"), "42%", "a value already above 1 is left as a percentage");
  assert.equal(bare(formatValue(12.5, "dollars")), "$125");
  assert.ok(formatValue(-3, "dollars").startsWith("-$"));
  assert.equal(formatValue(null, "matches"), "N/A");
  assert.equal(formatValue(NaN, "matches"), "N/A");
});

check("formatTickIsCompactForBigNumbersAndKeepsSymbols", () => {
  assert.equal(formatTick(50, "percent"), "50%");
  assert.ok(formatTick(80, "dollars").startsWith("$"));
  assert.ok(formatTick(-80, "dollars").startsWith("-$"));
  for (const big of [125000, 1250000, -125000]) assert.doesNotMatch(formatTick(big, "matches"), /NaN|undefined/);
});

check("clampBoundsBothEnds", () => {
  assert.equal(clamp(5, 0, 3), 3);
  assert.equal(clamp(-1, 0, 3), 0);
  assert.equal(clamp(2, 0, 3), 2);
});

check("naturalLimitsStopPaddingAtZeroAndOneHundredPercent", () => {
  assert.deepEqual(naturalLimits([210, 1500, 2750], "dollars"), { floor: 0 });
  assert.deepEqual(naturalLimits([-5, 10], "dollars"), {}, "signed data may cross zero");
  assert.deepEqual(naturalLimits([20, 60], "percent"), { floor: 0, ceil: 100 });
  assert.deepEqual(naturalLimits([20, 140], "percent"), { floor: 0 }, "growth past 100% is not capped");
  assert.deepEqual(naturalLimits([null, undefined], "dollars"), {});
});

check("niceScaleWithAFloorNeverPadsBelowZeroForNonNegativeData", () => {
  const padded = niceScale([210, 2750], { pad: 0.1, targetTicks: 3 });
  assert.ok(padded.min < 0, "without the floor, padding invents a negative tick");
  const floored = niceScale([210, 2750], { pad: 0.1, targetTicks: 3, floor: 0 });
  assert.equal(floored.min, 0);
  assert.ok(floored.ticks.every(tick => tick >= 0));
  assert.ok(floored.max >= 2750);
  const flatZero = niceScale([0, 0], { floor: 0 });
  assert.equal(flatZero.min, 0);
  assert.ok(flatZero.max > 0);
});

check("niceScaleWithACeilingNeverPadsPastOneHundredPercent", () => {
  const scale = niceScale([62, 97], { pad: 0.1, floor: 0, ceil: 100 });
  assert.equal(scale.max, 100);
  assert.ok(scale.ticks.every(tick => tick <= 100));
  const flatTop = niceScale([100, 100], { floor: 0, ceil: 100 });
  assert.equal(flatTop.max, 100);
  assert.ok(flatTop.min < 100);
});

check("barDomainMeasuresSharesAgainstTheWhole", () => {
  assert.deepEqual(barDomain([2, 8], "percent"), [0, 100]);
  assert.deepEqual(barDomain([0, 100], "adoption"), [0, 100]);
  assert.equal(barDomain([2, 140], "percent"), null);
  assert.equal(barDomain([-3, 8], "percent"), null);
  assert.equal(barDomain([2, 8], "matches"), null);
  assert.equal(barDomain([], "percent"), null);
  const scale = niceScale([2, 8], { zero: true, targetTicks: 5, domain: [0, 100] });
  assert.deepEqual(scale.ticks, [0, 20, 40, 60, 80, 100]);
  assert.equal(scale.min, 0);
  assert.equal(scale.max, 100);
});
