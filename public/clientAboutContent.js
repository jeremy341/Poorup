import { MUSIC_MANIFEST } from "./clientMusicData.js";

export const ABOUT_FAQ = Object.freeze([
  {
    question: "Is Poorup free to play?",
    answer: "Yes. Poorup is free and runs in your browser. There is nothing to download and no payment is needed to play a full game."
  },
  {
    question: "Do I need an account to play?",
    answer: "No. You can enter a nickname, create a room and share the code with friends. An account is optional and only adds things like a profile and rankings."
  },
  {
    question: "How many people can play?",
    answer: "A table seats two to four players on the standard board, and up to six on the larger Metro board. Empty seats can be filled with computer players."
  },
  {
    question: "Can I play Poorup alone or with bots?",
    answer: "Yes. The host can reserve seats for bots that buy, build, trade and bid at auction using the same rules as everyone else, so a single player can still run a full game."
  },
  {
    question: "Is Poorup the same as Monopoly?",
    answer: "No. Poorup is an independent game in the same family of property-trading board games. It has its own board, cards, art and rules, and it is not affiliated with Hasbro or the Monopoly brand."
  },
  {
    question: "Is Poorup like Richup.io?",
    answer: "It belongs to the same genre of free online property board games that you play in a browser with friends. Poorup is an independent project and is not affiliated with Richup.io."
  },
  {
    question: "How do I invite friends?",
    answer: "Create a private room, then share its six-character code or the link. Friends type the code on the home screen and take a seat. Public rooms can also be browsed and joined from the room list."
  },
  {
    question: "What are the rules?",
    answer: "Roll, move clockwise, buy properties, collect rent, build houses and hotels on full colour sets, trade and bid at auctions, and be the last player who can still pay their debts. The full guide is on the rules page."
  }
]);

const HOW_IT_PLAYS = Object.freeze([
  ["Roll and move", "On your turn you roll the dice and your token moves clockwise around the board."],
  ["Buy or auction", "Land on a free property and you can buy it. If you pass, it can go to an auction where every player can bid."],
  ["Collect rent", "When someone lands on a property you own they pay you rent. Own every property in a colour set to raise it, then build houses and hotels."],
  ["Trade and negotiate", "Swap properties and cash with other players to finish a set, or sell buildings and mortgage deeds when money gets tight."],
  ["Outlast the table", "Cards, taxes and rent keep draining wallets. The last player who can still pay their debts wins."]
]);

const FEATURES = Object.freeze([
  "Free, in your browser, with no download and no signup",
  "Two to four players, with computer players to fill empty seats",
  "Private rooms with a share code, plus a public room list",
  "Auctions, player-to-player trades, mortgages, houses and hotels",
  "Optional extras such as bank loans, a market and rare table-wide events",
  "A pixel-art look with a fast, readable board"
]);

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
}

export function renderAboutContent() {
  const features = FEATURES.map(text => `<li>${escapeHtml(text)}</li>`).join('');
  const steps = HOW_IT_PLAYS.map(([title, text]) => `<li><strong>${escapeHtml(title)}.</strong> ${escapeHtml(text)}</li>`).join('');
  const faq = ABOUT_FAQ.map(({ question, answer }) => `<details class="about-question"><summary>${escapeHtml(question)}</summary><p>${escapeHtml(answer)}</p></details>`).join('');
  const tracks = Object.values(MUSIC_MANIFEST.tracks).filter(track => track.status === 'approved').map(track => `<li><a href="${escapeHtml(track.source)}" target="_blank" rel="noopener noreferrer">${escapeHtml(track.title)}</a><span>${escapeHtml(track.artist)}</span><small>${escapeHtml(track.license)}</small></li>`).join('');
  return `<div class="about-document">
    <header class="about-intro">
      <div class="t-micro g400">THE AFTER-HOURS PARLOR</div>
      <h1 id="about-heading" tabindex="-1">About Poorup</h1>
      <p class="about-lead">A property game for friends, rivals, and the last wallet standing.</p>
      <p class="about-summary">Poorup is a free property-trading board game you play in your browser with friends or computer players. Roll the dice, buy properties, collect rent, trade and bid at auctions, and be the last player left standing. No download and no signup.</p>
      <div class="about-entry"><a class="cta-red about-play-link" href="/" data-home-tab="play">Play now</a><a class="btn-dark about-rules-link" href="/rules" data-top-surface="rules">Read the rules</a><span class="t-micro ink-3">FREE TO PLAY · ACCOUNT OPTIONAL</span></div>
      <noscript><p class="about-static-note">This information works without JavaScript. Playing Poorup requires JavaScript.</p></noscript>
    </header>
    <div class="about-reading-layout">
      <nav class="about-contents" aria-label="About sections"><span class="t-micro g400">IN THIS PARLOR</span><a href="#about-project">The project</a><a href="#about-features">What makes it Poorup</a><a href="#about-credits">Credits &amp; links</a><a href="#about-faq">Common questions</a></nav>
      <div class="about-reading">
        <section id="about-project" tabindex="-1" aria-labelledby="about-project-title"><div class="about-section-label t-micro g400">01 / THE PROJECT</div><h2 id="about-project-title">A game night, without the setup.</h2><p>Poorup is built to get friends around a table quickly. A browser, a name, and a room code are enough to start. Accounts are optional, and computer players can fill the empty seats.</p><p>The goal is a complete multiplayer property game where the next action is clear, the board stays at the center, and a lost connection does not mean losing your seat.</p><div class="about-note"><span class="t-micro g400">INDEPENDENT BY DESIGN</span><p>Poorup is an independent project. It is not Monopoly and is not affiliated with Hasbro, the Monopoly brand or Richup.io; those names belong to their owners and are used here only to describe the kind of game Poorup is.</p></div></section>
        <section id="about-features" tabindex="-1" aria-labelledby="about-features-title"><div class="about-section-label t-micro g400">02 / THE GAME</div><h2 id="about-features-title">Familiar stakes. Its own personality.</h2><p>Poorup is a free online Monopoly-style board game with its own board, cards, art and rules. Its after-hours pixel parlor brings a little character to every deal.</p><ul class="about-feature-list">${features}</ul><details class="about-basics"><summary>How a game of Poorup plays</summary><ol>${steps}</ol></details><p>If you have played Monopoly at home, or a free online version such as Richup.io, the loop will feel familiar: move around a board, buy what you land on, charge rent and negotiate. Poorup is its own game with its own board, cards and artwork, built to be quick to start and easy to read, with computer players, auctions and trades that follow the same rules as human seats.</p></section>
        <section id="about-credits" tabindex="-1" aria-labelledby="about-credits-title"><div class="about-section-label t-micro g400">03 / CREDITS &amp; LINKS</div><h2 id="about-credits-title">The details that make the parlor.</h2><div class="about-credit-row"><h3>Typography</h3><p>Pixelify Sans, Jersey 15, Silkscreen, and IBM Plex Mono.</p></div><div class="about-credit-row"><h3>Music</h3><p>The parlor's theme soundtracks come from the creators below. Each track links to its source and keeps its credited license.</p><details class="about-music-credits"><summary>Soundtrack credits</summary><ul>${tracks}</ul></details></div><div class="about-credit-row"><h3>Explore Poorup</h3><p><a href="/" data-home-tab="play">Take a seat</a><span aria-hidden="true"> · </span><a href="/rules" data-top-surface="rules">Read the full rules</a></p></div></section>
        <section id="about-faq" tabindex="-1" aria-labelledby="about-faq-title"><div class="about-section-label t-micro g400">04 / COMMON QUESTIONS</div><h2 id="about-faq-title">Before you take a seat.</h2>${faq}</section>
        <footer class="about-document-footer"><p>Poorup is a free browser game. Not affiliated with Hasbro, Monopoly or Richup.io.</p><a class="text-link" href="/privacy.html">Privacy</a><a class="btn-dark" href="/" data-home-tab="play">Back to the parlor</a></footer>
      </div>
    </div>
  </div>`;
}

