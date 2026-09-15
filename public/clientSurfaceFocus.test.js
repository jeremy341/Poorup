import assert from "node:assert/strict";

class FakeClassList {
  constructor(...names) { this.names = new Set(names); }
  contains(name) { return this.names.has(name); }
  toggle(name, force) {
    const next = force === undefined ? !this.names.has(name) : force;
    if (next) this.names.add(name); else this.names.delete(name);
    return next;
  }
}

class FakeElement {
  constructor(id, ...classes) {
    this.id = id;
    this.classList = new FakeClassList(...classes);
    this.attributes = {};
    this.children = [];
    this.parentElement = null;
    this.hidden = false;
    this.disabled = false;
  }
  append(child) { child.parentElement = this; this.children.push(child); }
  contains(node) { return this === node || this.children.some((child) => child.contains(node)); }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  querySelector(selector) {
    if (selector === "#trade-close") return this.children.find((child) => child.id === "trade-close") || null;
    return null;
  }
  querySelectorAll() { return this.children; }
  focus() { globalThis.document.activeElement = this; }
}

const trigger = new FakeElement("trade-trigger");
const surface = new FakeElement("trade-modal", "is-hidden");
const close = new FakeElement("trade-close");
surface.append(close);
const nodes = new Map([["#trade-modal", surface]]);
globalThis.window = { matchMedia: () => ({ matches: false }) };
globalThis.document = {
  activeElement: trigger,
  querySelector: (selector) => nodes.get(selector) || null,
  querySelectorAll: () => [],
  contains: (node) => node === trigger || node === surface || node === close,
};
globalThis.HTMLElement = FakeElement;
globalThis.requestAnimationFrame = (callback) => callback();
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
globalThis.sessionStorage = { getItem: () => null, setItem: () => {} };

const { state } = await import("./clientState.js");
state.phase = "playing";
const { openSurface, closeSurface, closeAllSurfaces } = await import("./clientSurfaces.js");

openSurface("#trade-modal", "#trade-close", { trigger });
assert.equal(document.activeElement, close);
closeSurface("#trade-modal");
assert.equal(document.activeElement, trigger);
closeAllSurfaces();

console.log("client surface trigger focus tests: passed");
