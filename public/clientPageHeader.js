// Shared, static page chrome. The existing controllers own navigation and state.
const PAGE_HEADER_VIEWS = Object.freeze(['home', 'profile', 'rankings', 'social', 'rules', 'about']);

const DESTINATIONS = Object.freeze([
  ['play', 'PLAY', 'home-tab'], ['rooms', 'ROOMS', 'home-tab'], ['profile', 'PROFILE', 'home-tab'],
  ['rankings', 'RANKINGS', 'top-surface'], ['social', 'SOCIAL', 'top-surface'], ['rules', 'RULES', 'top-surface'],
]);

function brandMarkup(view) {
  const brand = '<span data-sprite="logo" data-size="4"></span><div class="hdr-brand-text"><div class="hdr-wordmark">Poorup</div><div class="t-micro ink-3 hdr-sub">after-hours parlor</div></div>';
  if (view === 'home') return `<div class="hdr-brand">${brand}</div>`;
  const action = view === 'profile' ? 'id="profile-back-btn"' : view === 'about' ? 'data-about-back' : 'data-top-back="home"';
  const label = view === 'about' ? 'Back to the previous view' : 'Back to home';
  return `<button class="hdr-brand profile-back page-header-back" type="button" data-page-back ${action} aria-label="${label}" title="${label}"><span class="profile-back-arrow" aria-hidden="true">‹</span>${brand}</button>`;
}

function audioButton(view, kind, label) {
  const id = `${view === 'home' ? '' : `${view}-`}${kind}-toggle-btn`;
  const iconId = view === 'home' ? ` id="${kind}-toggle-icon"` : '';
  return `<button class="btn-dark audio-toggle" type="button" id="${id}" title="${label}" aria-label="${label}" aria-pressed="false"><img${iconId} src="/assets/${kind}-off.svg" alt="" width="24" height="24"></button>`;
}

// About is reachable from the footer ticker only; it is deliberately not a
// top-navigation tab.
function renderPageHeader(view) {
  if (!PAGE_HEADER_VIEWS.includes(view)) throw new RangeError('Unknown page header');
  const home = view === 'home';
  const active = home ? 'play' : view;
  const nav = DESTINATIONS.map(([destination, label, action]) => {
    const selected = destination === active;
    const id = home ? ` id="home-${destination}-tab"` : '';
    return `<button class="home-nav-tab${selected ? ' is-active' : ''}"${id} type="button" data-${action}="${destination}"${selected ? ' aria-current="page"' : ''}><span class="t-label f11">${label}</span></button>`;
  }).join('');
  return `<header class="hdr page-header" data-page-header="${view}">
    <div class="page-header-brand">${brandMarkup(view)}</div>
    <nav class="home-nav"${home ? ' id="home-nav"' : ''} data-global-nav aria-label="Parlor navigation">${nav}</nav>
    <div class="hdr-right">
      ${home ? '' : '<span class="hdr-connection" role="status" aria-live="polite"><span data-global-online aria-hidden="true"><span class="dot dot-green blink"></span></span><span class="t-label f11" data-global-connection-label>CONNECTING…</span></span>'}
      <button class="you-chip you-chip-btn" type="button"${home ? ' id="open-profile-btn"' : ''} data-global-profile-trigger title="Edit profile"><span class="you-chip-av"${home ? ' id="home-you-avatar"' : ''} data-global-you-avatar></span><span class="you-chip-text"><span class="t-micro g400">you are</span><span class="t-label f12 g300"${home ? ' id="home-you-name"' : ''} data-global-you-name>guest</span></span></button>
      <button class="btn-dark hdr-rules header-shortcut-toggle" type="button" id="${view}-shortcut-toggle-btn" data-shortcut-toggle aria-label="Single-key shortcuts" aria-pressed="true" title="Single-key shortcuts are on. Click to turn them off."><span class="t-label f12">KEYS: ON</span></button>
      ${audioButton(view, 'sound', 'Sound effects')}${audioButton(view, 'music', 'Parlor music')}${home ? '<span class="sr-live" id="music-status" role="status" aria-live="polite"></span>' : ''}
    </div>
  </header>`;
}

export function renderPageHeaders(html) {
  return String(html).replace(/<header\b[^>]*\bdata-page-header="(home|profile|rankings|social|rules|about)"[^>]*>[\s\S]*?<\/header>/g, (_match, view) => renderPageHeader(view));
}
