import { renderAboutContent } from './clientAboutContent.js';
import { hydrateSprites } from './clientSprites.js';
import { closeHeaderMenus } from './clientHomeMenu.js';

const VIEWS = new Set(['home', 'game', 'profile', 'rankings', 'social', 'rules', 'analytics', 'about']);
let showView = () => {};
let openHomeTab = () => {};
let openTopSurface = () => {};
let returnView = 'home';
let returnUrl = '/';
let returnFocus = null;
let bound = false;

function currentView() {
  return document.querySelector('.view:not(.is-hidden)')?.id.replace('view-', '').replace('admin-', '') || 'home';
}

function historyState(view, extra = {}) {
  const previous = history.state && typeof history.state === 'object' ? history.state : {};
  return { ...previous, poorupAbout: { view, ...extra } };
}

function renderContent() {
  const content = document.querySelector('#about-page-content');
  if (content && !content.firstElementChild) content.innerHTML = renderAboutContent();
}

export function configureAboutUi(hooks) {
  showView = hooks.showView;
  openHomeTab = hooks.openHomeTab;
  openTopSurface = hooks.openTopSurface;
  renderContent();
}

export function openAboutSurface({ history: recordHistory = true } = {}) {
  if (currentView() !== 'about') {
    returnFocus = document.activeElement;
    returnView = currentView();
    returnUrl = location.pathname === '/about' ? '/' : location.pathname + location.search + location.hash;
  }
  if (recordHistory && location.pathname !== '/about') {
    history.replaceState(historyState(returnView), '', location.href);
    history.pushState(historyState('about', { returnView, returnUrl, entered: true }), '', '/about');
  }
  closeHeaderMenus();
  renderContent();
  showView('about');
  document.querySelector('#about-heading')?.focus({ preventScroll: true });
}

export function syncAboutNavigation(view) {
  if (view !== 'about' && location.pathname === '/about') {
    history.replaceState(historyState(view), '', view === returnView ? returnUrl : '/');
  }
  document.querySelectorAll('[data-about-link]').forEach(link => {
    if (view === 'about') link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
}

function returnToPreviousView() {
  if (location.pathname === '/about' && history.state?.poorupAbout?.entered) history.back();
  else restoreView(returnView);
}

function focusable(element) {
  return element && element !== document.body && element !== document.documentElement && element.isConnected && element.getClientRects().length > 0 && !element.closest('[inert], .is-hidden');
}

function restoreView(view) {
  showView(view);
  const container = document.querySelector(view === 'analytics' ? '#view-admin-analytics' : `#view-${view}`);
  const menuTrigger = returnFocus?.closest('#panel-menu') ? document.querySelector('#panels-btn') : returnFocus?.closest('.home-menu-wrap')?.querySelector('[data-settings-toggle]');
  const fallback = [...(container?.querySelectorAll('main[tabindex], button:not([disabled]), a[href]') || [])].find(focusable);
  const target = focusable(returnFocus) ? returnFocus : focusable(menuTrigger) ? menuTrigger : fallback;
  target?.focus({ preventScroll: true });
}

// A primary click without modifier keys: the only clicks the About links take over.
function isPlainPrimaryClick(event) {
  return event.button === 0 && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey;
}

function scrollToAboutAnchor(event) {
  event.preventDefault();
  const target = document.getElementById(event.target.closest('a').getAttribute('href').slice(1));
  target?.scrollIntoView({ block: 'start' });
  target?.focus({ preventScroll: true });
}

// A return URL is kept only when it is a plain same-site path.
function safeReturnUrl(value) {
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') ? value : '/';
}

// Opening the About page from history: remember where to go back to, then show it.
function enterAboutFromHistory(marker) {
  returnView = VIEWS.has(marker?.returnView) ? marker.returnView : 'home';
  returnUrl = safeReturnUrl(marker?.returnUrl);
  showView('about');
  document.querySelector('#about-heading')?.focus({ preventScroll: true });
}

// Adds the About entry to one global nav, in the menu when there is one, else the header's right side.
function appendAboutLink(nav) {
  const header = nav.closest('header');
  if (header.hasAttribute('data-page-header')) return;
  const menu = header.querySelector('#home-menu');
  const container = menu || header.querySelector('.hdr-right');
  if (!container || header.closest('#view-about')) return;
  const link = document.createElement('a');
  link.href = '/about';
  link.dataset.aboutLink = '';
  link.setAttribute('aria-label', 'About Poorup');
  link.title = 'About Poorup';
  link.className = menu ? 'btn-dark home-menu-item about-menu-entry' : 'btn-dark audio-toggle about-info-link';
  link.innerHTML = menu ? '<span class="t-label f12">ABOUT POORUP</span>' : '<span data-sprite="help" data-size="3" aria-hidden="true"></span>';
  container.append(link);
}

function handleAboutClick(event) {
  const plain = isPlainPrimaryClick(event);
  const link = event.target.closest('a[href="/about"], [data-about-link]');
  if (link && plain) {
    event.preventDefault();
    openAboutSurface();
  } else if (event.target.closest('[data-about-back]')) returnToPreviousView();
  else if (plain && event.target.closest('#view-about a[href^="#about-"]')) scrollToAboutAnchor(event);
  const entry = event.target.closest('#about-page-content [data-home-tab], #about-page-content [data-top-surface]');
  if (entry && plain) {
    event.preventDefault();
    if (entry.dataset.homeTab) openHomeTab(entry);
    else openTopSurface(entry);
  }
}

function handleAboutPopState(event) {
  const marker = event.state?.poorupAbout;
  if (location.pathname === '/about') enterAboutFromHistory(marker);
  else if (marker && VIEWS.has(marker.view)) restoreView(marker.view);
  else if (currentView() === 'about') restoreView(returnView);
}

export function bindAboutUi() {
  if (bound) return;
  bound = true;
  document.querySelectorAll('[data-global-nav]').forEach(appendAboutLink);
  hydrateSprites();
  document.addEventListener('click', handleAboutClick);
  window.addEventListener('popstate', handleAboutPopState);
}
