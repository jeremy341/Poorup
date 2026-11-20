// The parlor dropdown: a button-and-menu select with keyboard navigation, used by the trade and financing modals.
import { esc } from "./clientDom.js";

export function dropdownHTML({ id, label, value, options, className = "" }) {
  const selected = options.find((option) => String(option.value) === String(value)) || options[0];
  return `<div class="parlor-dropdown ${className}" data-dropdown="${esc(id)}"><span class="t-label f11 g-muted">${esc(label)}</span><button class="parlor-dropdown-trigger field" id="${esc(id)}-trigger" type="button" aria-label="${esc(label)}" aria-haspopup="listbox" aria-expanded="false" aria-controls="${esc(id)}-menu"><span data-dropdown-value>${esc(selected?.label || "SELECT")}</span><span class="parlor-dropdown-caret" aria-hidden="true">▾</span></button><div class="parlor-dropdown-menu" id="${esc(id)}-menu" role="listbox" tabindex="-1" hidden>${options.map((option) => `<button class="parlor-dropdown-option" type="button" role="option" aria-selected="${String(option.value) === String(selected?.value)}" data-dropdown-value-option="${esc(option.value)}">${esc(option.label)}</button>`).join("")}</div></div>`;
}

const DROPDOWN_ARROWS = ["ArrowDown", "ArrowUp", "Home", "End"];

function dropdownFocusIndex(options, key, current) {
  if (key === "Home") return 0;
  if (key === "End") return options.length - 1;
  const step = key === "ArrowDown" ? 1 : -1;
  return (current + step + options.length) % options.length;
}

function focusDropdownOption(menu, option) {
  if (!option) return;
  option.focus({ preventScroll: true });
  const bounds = menu.getBoundingClientRect();
  const focused = option.getBoundingClientRect();
  const top = bounds.top + menu.clientTop;
  const bottom = top + menu.clientHeight;
  if (focused.top < top) menu.scrollTop -= top - focused.top;
  else if (focused.bottom > bottom) menu.scrollTop += focused.bottom - bottom;
}

function onDropdownMenuKey(event, menu, trigger, close) {
  const options = [...menu.querySelectorAll("[data-dropdown-value-option]")];
  if (event.key === "Escape") {
    event.preventDefault();
    close();
    trigger.focus({ preventScroll: true });
    return;
  }
  if (DROPDOWN_ARROWS.includes(event.key)) {
    event.preventDefault();
    const index = dropdownFocusIndex(options, event.key, options.indexOf(document.activeElement));
    focusDropdownOption(menu, options[index]);
  }
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    document.activeElement?.click();
  }
}

function fitFinancingDropdownMenu(dropdown, trigger, menu) {
  const form = dropdown.closest(".financing-form");
  if (!form) return;
  const bounds = form.getBoundingClientRect();
  const anchor = trigger.getBoundingClientRect();
  const below = Math.max(0, bounds.bottom - anchor.bottom - 8);
  const above = Math.max(0, anchor.top - bounds.top - 8);
  const upward = below < Math.min(menu.scrollHeight, 240) && above > below;
  menu.style.top = upward ? "auto" : "calc(100% + 4px)";
  menu.style.bottom = upward ? `${dropdown.getBoundingClientRect().bottom - anchor.top + 4}px` : "auto";
  menu.style.maxHeight = `${Math.floor(upward ? above : below)}px`;
}

export function bindDropdowns(root, onSelect) {
  if (!root) return;
  const closeMenus = (except = null) => root.querySelectorAll(".parlor-dropdown").forEach((dropdown) => {
    if (dropdown !== except) {
      const trigger = dropdown.querySelector(".parlor-dropdown-trigger");
      const menu = dropdown.querySelector(".parlor-dropdown-menu");
      trigger?.setAttribute("aria-expanded", "false");
      if (menu) menu.hidden = true;
    }
  });
  root.querySelectorAll(".parlor-dropdown").forEach((dropdown) => {
    const id = dropdown.dataset.dropdown;
    const trigger = dropdown.querySelector(".parlor-dropdown-trigger");
    const menu = dropdown.querySelector(".parlor-dropdown-menu");
    if (!trigger || !menu) return;
    const open = () => {
      closeMenus(dropdown);
      menu.hidden = false;
      fitFinancingDropdownMenu(dropdown, trigger, menu);
      trigger.setAttribute("aria-expanded", "true");
      focusDropdownOption(menu, menu.querySelector("[aria-selected=true]"));
    };
    const close = () => {
      menu.hidden = true;
      trigger.setAttribute("aria-expanded", "false");
    };
    trigger.addEventListener("click", () => (menu.hidden ? open() : close()));
    trigger.addEventListener("keydown", (event) => {
      if (["Enter", " ", "ArrowDown"].includes(event.key)) { event.preventDefault(); open(); }
    });
    menu.addEventListener("click", (event) => {
      const option = event.target.closest("[data-dropdown-value-option]");
      if (!option) return;
      const value = option.dataset.dropdownValueOption;
      dropdown.querySelectorAll("[data-dropdown-value-option]").forEach((candidate) => candidate.setAttribute("aria-selected", String(candidate === option)));
      const valueEl = dropdown.querySelector("[data-dropdown-value]");
      if (valueEl) valueEl.textContent = option.textContent;
      close();
      onSelect?.(id, value);
      trigger.focus({ preventScroll: true });
    });
    menu.addEventListener("keydown", (event) => onDropdownMenuKey(event, menu, trigger, close));
  });
  if (!root.dataset.dropdownOutsideBound) {
    root.addEventListener("click", (event) => { if (!event.target.closest(".parlor-dropdown")) closeMenus(); });
    root.dataset.dropdownOutsideBound = "true";
  }
}
