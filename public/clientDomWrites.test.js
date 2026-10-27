/* global process */
import assert from "node:assert/strict";

globalThis.window = { matchMedia: () => ({ matches: false, addEventListener() {} }) };
globalThis.document = { querySelector: () => null };
const { setHtml, setText } = await import("./clientDom.js");

// A stand-in for a DOM element that behaves like the browser where it matters here: assigning
// innerHTML replaces every child node and drops scroll position and focus inside the subtree.
function fakeElement() {
  const el = {
    writes: 0,
    scrollTop: 0,
    focused: false,
    marker: null,
    firstChild: null,
    lastChild: null,
    _html: "",
    get innerHTML() { return el._html; },
    set innerHTML(value) {
      el.writes += 1;
      el._html = String(value);
      el.firstChild = el._html ? { html: el._html } : null;
      el.lastChild = el.firstChild;
      el.scrollTop = 0;
      el.focused = false;
    },
    querySelector() { return el.marker; },
  };
  return el;
}

function test(name, fn) {
  try { fn(); console.log(`ok - ${name}`); } catch (error) { console.error(`not ok - ${name}\n${error.stack}`); process.exitCode = 1; }
}

test("the first write goes through and reports that it changed the element", () => {
  const el = fakeElement();
  assert.equal(setHtml(el, "<p>a</p>"), true);
  assert.equal(el.innerHTML, "<p>a</p>");
  assert.equal(el.writes, 1);
});

test("unchanged markup does not touch the element and keeps its nodes, scroll and focus", () => {
  const el = fakeElement();
  setHtml(el, "<p>a</p>");
  const child = el.firstChild;
  el.scrollTop = 120;
  el.focused = true;
  assert.equal(setHtml(el, "<p>a</p>"), false);
  assert.equal(el.writes, 1);
  assert.equal(el.firstChild, child);
  assert.equal(el.scrollTop, 120);
  assert.equal(el.focused, true);
});

test("changed markup is written and reports that it changed the element", () => {
  const el = fakeElement();
  setHtml(el, "<p>a</p>");
  assert.equal(setHtml(el, "<p>b</p>"), true);
  assert.equal(el.innerHTML, "<p>b</p>");
  assert.equal(el.writes, 2);
  assert.equal(setHtml(el, "<p>a</p>"), true, "returning to an earlier string is still a change");
  assert.equal(el.writes, 3);
});

test("markup written around the helper is replaced instead of being treated as current", () => {
  const el = fakeElement();
  setHtml(el, "<p>a</p>");
  el.innerHTML = "<p>other</p>";
  assert.equal(setHtml(el, "<p>a</p>"), true);
  assert.equal(el.innerHTML, "<p>a</p>");
});

test("a re-created element is never skipped because an earlier element held the same markup", () => {
  const first = fakeElement();
  setHtml(first, "<p>a</p>");
  const second = fakeElement();
  assert.equal(setHtml(second, "<p>a</p>"), true);
  assert.equal(second.innerHTML, "<p>a</p>");
});

test("a control left pending or an action status appended in place forces the old rewrite", () => {
  const el = fakeElement();
  setHtml(el, "<button>x</button>");
  el.marker = { pending: true };
  assert.equal(setHtml(el, "<button>x</button>"), true);
  assert.equal(el.writes, 2);
  el.marker = null;
  assert.equal(setHtml(el, "<button>x</button>"), false);
  assert.equal(el.writes, 2);
});

test("empty markup on an element that is already empty is not written", () => {
  const el = fakeElement();
  assert.equal(setHtml(el, ""), false);
  assert.equal(el.writes, 0);
  setHtml(el, "<i></i>");
  assert.equal(setHtml(el, ""), true, "clearing a populated element still writes");
  assert.equal(el.innerHTML, "");
});

test("a missing element is ignored", () => {
  assert.equal(setHtml(null, "<p>a</p>"), false);
});

// A text-only stand-in: assigning textContent replaces every child with one text node (or none).
function fakeTextElement(initialChildren = []) {
  const el = {
    writes: 0,
    childNodes: initialChildren,
    get firstChild() { return el.childNodes[0] || null; },
    get textContent() { return el.childNodes.map((node) => node.data).join(""); },
    set textContent(value) {
      el.writes += 1;
      el.childNodes = String(value) === "" ? [] : [{ nodeType: 3, data: String(value), nextSibling: null }];
    },
  };
  return el;
}

test("setText writes new text and skips identical text so layout is not invalidated", () => {
  const el = fakeTextElement();
  assert.equal(setText(el, "ONLINE"), true);
  assert.equal(el.writes, 1);
  const node = el.firstChild;
  assert.equal(setText(el, "ONLINE"), false);
  assert.equal(el.writes, 1);
  assert.equal(el.firstChild, node, "the text node survives an unchanged render");
  assert.equal(setText(el, "OFFLINE"), true);
  assert.equal(el.textContent, "OFFLINE");
  assert.equal(setText(el, 12), true, "non-string values are written as their string");
  assert.equal(el.textContent, "12");
  assert.equal(setText(el, 12), false);
});

test("setText still replaces markup that merely has the same text", () => {
  const el = fakeTextElement([{ nodeType: 1, data: "X", nextSibling: null }]);
  assert.equal(el.textContent, "X");
  assert.equal(setText(el, "X"), true, "an element child is not a plain text node");
  assert.equal(el.firstChild.nodeType, 3);
  const mixed = fakeTextElement();
  mixed.childNodes = [{ nodeType: 3, data: "A", nextSibling: {} }, { nodeType: 3, data: "B", nextSibling: null }];
  assert.equal(setText(mixed, "A"), true, "a text node with a sibling is not the whole content");
});

test("setText leaves an empty element empty without a write and ignores a missing element", () => {
  const el = fakeTextElement();
  assert.equal(setText(el, ""), false);
  assert.equal(el.writes, 0);
  setText(el, "x");
  assert.equal(setText(el, ""), true);
  assert.equal(el.childNodes.length, 0);
  assert.equal(setText(null, "x"), false);
});
