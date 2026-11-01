// The public page for a computer player. It sits outside any room, like an account profile, and shows only that computer's own record:
// games, wins, the unlocks it earned and its recent matches. Computer players have no friends, rankings or privacy settings.
import { esc } from "./clientDom.js";

let deps = { emit: () => {}, showView: () => {}, notice: () => {} };

export function configureComputerProfile(hooks) {
  deps = { ...deps, ...hooks };
}

function ensureRoot() {
  let root = document.querySelector("#view-computer");
  if (root) return root;
  root = document.createElement("div");
  root.className = "view is-hidden";
  root.id = "view-computer";
  document.querySelector("#view-profile")?.insertAdjacentElement("afterend", root);
  return root;
}

function formatPercent(wins, games) {
  if (!games) return "0%";
  return `${Math.round((wins / games) * 100)}%`;
}

function formatDate(value) {
  return value ? String(value).slice(0, 10) : "UNDATED";
}

function unlockHTML(entry) {
  return `<li class="computer-profile-unlock"><div class="computer-profile-unlock-head"><strong class="t-label f11 g100">${esc(entry.title || entry.achievementId)}</strong><span class="t-micro ink-3">${esc(entry.rarity || "")}</span></div><p class="t-body ink-2">${esc(entry.body || "")}</p></li>`;
}

function matchRowHTML(match) {
  const placement = match.placement === 1 ? "WIN" : match.placement ? `PLACE ${esc(match.placement)}` : "MATCH";
  const tone = match.placement === 1 ? "green" : "g100";
  return `<div class="player-profile-match"><span class="t-micro ink-3">${esc(formatDate(match.completedAt))}</span><strong class="t-label f11 ${tone}">${placement}</strong><span class="t-micro ink-3">${esc(match.players)} PLAYERS · ${esc(match.events)} EVENTS</span></div>`;
}

function renderComputerProfile(profile, matches) {
  const root = ensureRoot();
  const unlocked = Array.isArray(profile.unlocked) ? profile.unlocked : [];
  const unlocks = unlocked.length
    ? `<ul class="computer-profile-unlocks">${unlocked.map(unlockHTML).join("")}</ul>`
    : `<p class="t-body ink-3 social-empty">NO UNLOCKS YET.</p>`;
  const recent = matches.length
    ? matches.map(matchRowHTML).join("")
    : `<p class="t-body ink-3 social-empty">NO MATCHES YET.</p>`;
  root.innerHTML = `<main class="computer-profile-main thin-scroll">
    <div class="computer-profile-top">
      <button class="btn-dark" id="computer-profile-back" type="button"><span class="t-label f11">‹ BACK</span></button>
    </div>
    <section class="profile-hero computer-profile-hero" aria-labelledby="computer-profile-name">
      <div class="t-micro g400">COMPUTER PLAYER · ${esc(String(profile.difficulty || "table").toUpperCase())}</div>
      <h1 class="t-section g100" id="computer-profile-name">${esc(profile.name)}</h1>
      <p class="t-body ink-2">A computer player. Its record is kept apart from accounts, friends and rankings.</p>
    </section>
    <section class="profile-stat-rail computer-profile-stats" aria-label="Record">
      <div class="profile-stat"><span class="t-micro ink-3">GAMES</span><strong class="t-label f13 g100">${esc(profile.gamesPlayed ?? 0)}</strong></div>
      <div class="profile-stat"><span class="t-micro ink-3">WINS</span><strong class="t-label f13 green">${esc(profile.wins ?? 0)}</strong></div>
      <div class="profile-stat"><span class="t-micro ink-3">WIN RATE</span><strong class="t-label f13 g100">${formatPercent(profile.wins, profile.gamesPlayed)}</strong></div>
      <div class="profile-stat"><span class="t-micro ink-3">ACHIEVEMENTS</span><strong class="t-label f13 g300">${unlocked.length}</strong></div>
    </section>
    <section class="computer-profile-section" aria-labelledby="computer-profile-unlocks-title">
      <div class="t-micro g400" id="computer-profile-unlocks-title">ACHIEVEMENTS</div>
      ${unlocks}
    </section>
    <section class="computer-profile-section" aria-labelledby="computer-profile-matches-title">
      <div class="t-micro g400" id="computer-profile-matches-title">RECENT MATCHES</div>
      ${recent}
    </section>
  </main>`;
  root.querySelector("#computer-profile-back")?.addEventListener("click", () => deps.showView("home"));
}

export function openComputerProfile(personaId) {
  deps.emit("get-computer-profile", { personaId }, (response) => {
    if (response?.success === false || !response?.profile) {
      deps.notice(response?.error || "Computer player could not be opened.");
      return;
    }
    renderComputerProfile(response.profile, Array.isArray(response.matches) ? response.matches : []);
    deps.showView("computer");
  });
}
