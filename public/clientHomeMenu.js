/* ============================================================
   PAGE SETTINGS: the same small popover on every shared page bar. It holds the
   keyboard-shortcut switch so the bar itself stays quiet. The switch is
   still the [data-shortcut-toggle] button, so its saved preference and
   label keep working unchanged.
   ============================================================ */
let bound = false;
let activeButton = null;

export function closeHeaderMenus({ restoreFocus = false } = {}) {
  const button = activeButton;
  document.querySelectorAll('[data-settings-menu]').forEach(menu => menu.classList.add('is-hidden'));
  document.querySelectorAll('[data-settings-toggle]').forEach(toggle => toggle.setAttribute('aria-expanded', 'false'));
  activeButton = null;
  if (restoreFocus && button?.isConnected) button.focus({ preventScroll: true });
}

function toggleMenu(button) {
  const menu = document.getElementById(button.getAttribute('aria-controls'));
  if (!menu?.matches('[data-settings-menu]')) return;
  const open = button.getAttribute('aria-expanded') !== 'true';
  closeHeaderMenus();
  if (!open) return;
  menu.classList.remove('is-hidden');
  button.setAttribute('aria-expanded', 'true');
  activeButton = button;
}

export function bindHomeMenu() {
  if (bound) return;
  bound = true;
  document.addEventListener("click", (event) => {
    const button = event.target.closest('[data-settings-toggle]');
    if (button) toggleMenu(button);
    else if (activeButton && !event.target.closest('.home-menu-wrap')) closeHeaderMenus();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !activeButton) return;
    event.preventDefault();
    event.stopPropagation();
    closeHeaderMenus({ restoreFocus: true });
  });
}
