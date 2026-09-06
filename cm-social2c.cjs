const fs = require("fs");
const MOD = "public/clientSocialSurfaces.js";
let lines = fs.readFileSync(MOD, "utf8").split(/\r?\n/);
function assert(cond, msg) { if (!cond) throw new Error("ASSERT: " + msg); }
function findIdx(pred, msg) { const i = lines.findIndex(pred); assert(i >= 0, msg); return i; }
function fnEnd(startIdx) { let i = startIdx; while (lines[i] !== "}") i += 1; return i; }
function subIn(line, from, to, expect) {
  const count = line.split(from).length - 1;
  assert(count === (expect === undefined ? 1 : expect), `sub x${count} != ${expect} for ${JSON.stringify(from.slice(0, 60))}`);
  return line.split(from).join(to);
}

// ---------- C. renderRulesSurface ----------
{
  const s = findIdx((l) => l.startsWith("export function renderRulesSurface"), "rules start");
  const e = fnEnd(s);
  const matchesIdx = findIdx((l) => l.startsWith("  const matches = (section) =>"), "matches closure");
  const aTrueIdx = findIdx((l) => l.trim().startsWith("? `<article class=\"rules-book-page noise\""), "article true");
  const articleTrue = lines[aTrueIdx];
  const articleFalse = lines[aTrueIdx + 1];
  assert(articleFalse.trim().startsWith(": `<article class=\"rules-book-page\"><div class=\"rules-book-page-scroll\">"), "article false line");
  let at = articleTrue.trim().slice("? ".length, -1);
  const emptyArticle = articleFalse.trim().slice(": ".length, -1);
  at = subIn(at, 'data-rules-section="${previous?.id || ""}" ${previous ? "" : "disabled"}', 'data-rules-section="${prevNav.id}" ${prevNav.disabled}');
  at = subIn(at, '${previous ? `PREVIOUS · ${previous.label}` : "FIRST CHAPTER"}', '${prevNav.label}');
  at = subIn(at, 'data-rules-section="${next?.id || ""}" ${next ? "" : "disabled"}', 'data-rules-section="${nextNav.id}" ${nextNav.disabled}');
  at = subIn(at, '${next ? `NEXT · ${next.label}` : "LAST CHAPTER"}', '${nextNav.label}');
  const indexLineIdx = findIdx((l) => l.includes('aria-label="Rules chapters"'), "index line");
  let indexLine = lines[indexLineIdx];
  indexLine = subIn(indexLine, '<button class="rules-index-link${section.id === active?.id ? " is-active" : ""}${matches(section) ? "" : " is-filtered"}" type="button" data-rules-section="${section.id}" aria-current="${section.id === active?.id ? "page" : "false"}">', '<button class="rules-index-link${indexLinkClasses(section, active, query)}" type="button" data-rules-section="${section.id}" aria-current="${indexAriaCurrent(section, active)}">');
  const toolbarIdx = findIdx((l) => l.includes('value="${esc(state.rulesQuery || "")}"'), "toolbar line");
  assert(toolbarIdx < indexLineIdx, "toolbar before index");
  let toolbarLine = lines[toolbarIdx];
  toolbarLine = subIn(toolbarLine, 'value="${esc(state.rulesQuery || "")}"', 'value="${searchValue}"');
  toolbarLine = subIn(toolbarLine, '${matches(RULES_SECTIONS).length}', '${filteredSections.length}');

  const helpers = `function rulesQuery() {
  return String(state.rulesQuery || "").trim().toLowerCase();
}

function sectionMatches(section, query) {
  if (!query) return true;
  const text = [section.label, section.title, section.summary, section.content].join(" ").toLowerCase();
  return text.includes(query);
}

function resolveActiveSection(requested, filteredSections, query) {
  if (sectionMatches(requested, query)) return requested;
  return filteredSections[0] || null;
}

function previousSection(activeIndex) {
  if (activeIndex <= 0) return null;
  return RULES_SECTIONS[activeIndex - 1];
}

function nextSection(activeIndex) {
  const last = RULES_SECTIONS.length - 1;
  if (activeIndex < 0) return null;
  if (activeIndex >= last) return null;
  return RULES_SECTIONS[activeIndex + 1];
}

function rulesPrevNav(previous) {
  const id = previous?.id || "";
  const disabled = previous ? "" : "disabled";
  const label = previous ? \`PREVIOUS · \${previous.label}\` : "FIRST CHAPTER";
  return { id, disabled, label };
}

function rulesNextNav(next) {
  const id = next?.id || "";
  const disabled = next ? "" : "disabled";
  const label = next ? \`NEXT · \${next.label}\` : "LAST CHAPTER";
  return { id, disabled, label };
}

function rulesArticleHTML(active, activeIndex, prevNav, nextNav) {
  return ${at};
}

function rulesEmptyArticleHTML() {
  return ${emptyArticle};
}

function indexLinkClasses(section, active, query) {
  const selected = section.id === active?.id ? " is-active" : "";
  const filtered = sectionMatches(section, query) ? "" : " is-filtered";
  return \`\${selected}\${filtered}\`;
}

function indexAriaCurrent(section, active) {
  if (section.id === active?.id) return "page";
  return "false";
}`.split("\n");

  const shellLines = lines.slice(aTrueIdx + 2, e); // root.innerHTML multi-line template + tail
  // patch index line inside shellLines (they begin with "  root.innerHTML = `")
  let li = shellLines.findIndex((l) => l.includes('aria-label="Rules chapters"'));
  assert(li >= 0, "shell index");
  shellLines[li] = indexLine;
  li = shellLines.findIndex((l) => l.includes("rules-toolbar panel noise"));
  assert(li >= 0, "shell toolbar");
  shellLines[li] = toolbarLine;
  const newFn = `export function renderRulesSurface(target = "#rules-page-content") {
  const root = $(target);
  if (!root) return;
  const query = rulesQuery();
  const filteredSections = RULES_SECTIONS.filter((section) => sectionMatches(section, query));
  const requested = rulesSectionById(state.rulesSection);
  const active = resolveActiveSection(requested, filteredSections, query);
  if (active) state.rulesSection = active.id;
  const activeIndex = active ? RULES_SECTIONS.findIndex((section) => section.id === active.id) : -1;
  const previous = previousSection(activeIndex);
  const next = nextSection(activeIndex);
  const prevNav = rulesPrevNav(previous);
  const nextNav = rulesNextNav(next);
  const article = active ? rulesArticleHTML(active, activeIndex, prevNav, nextNav) : rulesEmptyArticleHTML();
  const searchValue = esc(state.rulesQuery || "");`.split("\n");
  lines = [...lines.slice(0, s), ...helpers, "", ...newFn, ...shellLines, ...lines.slice(e + 1)];
}

// ---------- F. announceSocialNotification ----------
{
  const s = findIdx((l) => l.startsWith("export function announceSocialNotification"), "announce start");
  const e = fnEnd(s);
  const newFn = `export function announceSocialNotification(n) {
  const kind = notificationKind(n);
  const copy = notificationCopy(n);
  announceToScreenReaders(copy.label, copy.detail, kind.isError);
  const stack = $("#toast-stack");
  if (!stack) return;
  mountParlorToast(stack, kind.kind, copy.label, copy.detail, kind.isError);
}

function notificationKind(n) {
  const kind = String(n?.kind || "");
  return { kind, isError: kind === "parlor-error" };
}

function notificationCopy(n) {
  const label = String(n?.title || "Parlor Notice").toUpperCase();
  const detail = String(n?.message || n?.body || "").replace(/\\s+/g, " ");
  return { label, detail };
}

function announcementText(label, detail) {
  if (!detail) return label;
  return \`\${label}. \${detail}\`;
}

function announceToScreenReaders(label, detail, isError) {
  const text = announcementText(label, detail);
  const systemAnnouncer = $("#system-announcer");
  if (systemAnnouncer) systemAnnouncer.textContent = text;
  if (!isError) return;
  const errorAnnouncer = $("#error-announcer");
  if (errorAnnouncer) errorAnnouncer.textContent = text;
}

function toastClass(kind, isError) {
  const mythical = kind === "mythical-achievement" ? " is-mythical" : "";
  const errorCls = isError ? " is-error" : "";
  return \`parlor-toast\${mythical}\${errorCls}\`;
}

function toastTitleEl(label, isError) {
  const title = document.createElement("strong");
  title.className = "t-label f11 parlor-toast-title";
  if (isError) {
    const glyph = document.createElement("span");
    glyph.className = "parlor-toast-glyph";
    glyph.setAttribute("aria-hidden", "true");
    glyph.innerHTML = '<svg viewBox="0 0 12 12" focusable="false" shape-rendering="crispEdges"><path fill="currentColor" fill-rule="evenodd" d="M5 1h2l1 2 1 2 1 2 1 2 1 3H0l1-3 1-2 1-2 1-2zM5 4h2v3H5zm0 4h2v2H5z"/></svg>';
    title.appendChild(glyph);
  }
  title.append(document.createTextNode(label));
  return title;
}

function toastBodyEl(detail) {
  const body = document.createElement("span");
  body.className = "t-body f12 parlor-toast-body";
  body.textContent = detail;
  return body;
}

function toastDismissEl() {
  const dismiss = document.createElement("button");
  dismiss.type = "button";
  dismiss.className = "parlor-toast-close";
  dismiss.tabIndex = -1;
  dismiss.setAttribute("aria-hidden", "true");
  dismiss.textContent = "\\u00d7";
  return dismiss;
}

function autoDismissMs(kind, isError) {
  if (isError) return 6500;
  if (kind === "mythical-achievement") return 6500;
  return 4200;
}

function dismissToastLater(toast) {
  if (!toast.isConnected) return;
  if (toast.classList.contains("is-leaving")) return;
  clearTimeout(toast._autoTimer);
  toast.classList.add("is-leaving");
  syncToastStack();
  setTimeout(() => toast.remove(), 160);
}

function trimToastStack(stack) {
  while (stack.children.length > 4) stack.firstElementChild.remove();
}

function mountParlorToast(stack, kind, label, detail, isError) {
  const toast = document.createElement("div");
  toast.className = toastClass(kind, isError);
  const title = toastTitleEl(label, isError);
  const body = toastBodyEl(detail);
  const dismiss = toastDismissEl();
  const dismissToast = () => dismissToastLater(toast);
  toast.append(title, body, dismiss);
  toast.addEventListener("click", dismissToast);
  dismiss.addEventListener("click", (event) => {
    event.stopPropagation();
    dismissToast();
  });
  stack.append(toast);
  trimToastStack(stack);
  syncToastStack();
  toast._autoTimer = setTimeout(dismissToast, autoDismissMs(kind, isError));
}`.split("\n");
  lines = [...lines.slice(0, s), ...newFn, ...lines.slice(e + 1)];
}

fs.writeFileSync(MOD, lines.join("\n"));
console.log("CF done, lines:", lines.length);
