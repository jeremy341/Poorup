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
  "In-room chat, with reconnect support for dropped connections",
  "Auctions, player-to-player trades, mortgages, houses and hotels",
  "Optional extras such as bank loans, a market and rare table-wide events",
  "A pixel-art look with a fast, readable board"
]);

// The admission ticket in the masthead is a decorative echo, like the pull quote:
// it is hidden from assistive technology and every fact on it is lifted from copy
// that is visible elsewhere on the page (the summary, the project text, the FAQ),
// so it can never introduce a claim of its own.
const TICKET_FACTS = Object.freeze([
  ["Seats", "2–4 players, 6 on Metro"],
  ["To start", "A name and a room code"],
  ["Account", "Optional"],
  ["Empty seats", "Computer players"]
]);
const TICKET_CODE = Object.freeze([..."POORUP"]);

// Two pixel dice resting beside the ticket: a 12-unit die drawn on a 3px grid.
const DICE = '<svg class="about-dice" viewBox="0 0 27 16" width="81" height="48" shape-rendering="crispEdges" focusable="false" aria-hidden="true">'
  + '<g><rect class="die-edge" width="12" height="12"/><rect class="die-face" x="1" y="1" width="10" height="10"/><path class="die-shade" d="M10 1h1v10H1v-1h9z"/>'
  + '<path class="die-pip" d="M2 2h2v2H2zM8 2h2v2H8zM5 5h2v2H5zM2 8h2v2H2zM8 8h2v2H8z"/></g>'
  + '<g transform="translate(15 4)"><rect class="die-edge" width="12" height="12"/><rect class="die-face" x="1" y="1" width="10" height="10"/><path class="die-shade" d="M10 1h1v10H1v-1h9z"/>'
  + '<path class="die-pip" d="M2 2h2v2H2zM8 8h2v2H8z"/></g></svg>';

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
}

export function renderAboutContent() {
  const features = FEATURES.map(text => `<li>${escapeHtml(text)}</li>`).join('');
  const steps = HOW_IT_PLAYS.map(([title, text]) => `<li><strong>${escapeHtml(title)}.</strong> <span>${escapeHtml(text)}</span></li>`).join('');
  const faq = ABOUT_FAQ.map(({ question, answer }) => `<details class="about-question"><summary>${escapeHtml(question)}</summary><p>${escapeHtml(answer)}</p></details>`).join('');
  const tracks = Object.values(MUSIC_MANIFEST.tracks).filter(track => track.status === 'approved').map(track => `<li><a href="${escapeHtml(track.source)}" target="_blank" rel="noopener noreferrer">${escapeHtml(track.title)}</a><span>${escapeHtml(track.artist)}</span><small>${escapeHtml(track.license)}</small></li>`).join('');
  // The soundtrack row only exists while the manifest has approved tracks to credit.
  const musicRow = tracks ? `<div class="about-credit-row">
            <h3>Music</h3>
            <div class="about-credit-copy">
              <p>Your theme picks the soundtrack. Each track lists who made it, where to find it, and its license.</p>
              <details class="about-music-credits"><summary>Soundtrack credits</summary><ul role="list">${tracks}</ul></details>
            </div>
          </div>` : '';
  const facts = TICKET_FACTS.map(([label, value]) => `<li><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></li>`).join('');
  const code = TICKET_CODE.map(character => `<span>${escapeHtml(character)}</span>`).join('');
  const ticket = `<div class="about-ticket" aria-hidden="true"><p class="about-ticket-head"><span>POORUP</span><span>ADMIT ONE</span></p><p class="about-ticket-price"><strong>FREE</strong><span>In your browser. Nothing to download.</span></p><ul class="about-ticket-facts">${facts}</ul><p class="about-ticket-stub"><span>ROOM CODE</span><span class="about-ticket-code">${code}</span></p>${DICE}</div>`;
  return `<div class="about-document">
    <header class="about-header panel">
      <div class="about-header-copy">
        <div class="t-micro ink-2">THE AFTER-HOURS PARLOR</div>
        <h1 id="about-heading" tabindex="-1">About Poorup</h1>
        <p class="about-lead">A property game for friends, rivals, and the last wallet standing.</p>
        <p class="about-summary">Poorup is a free property-trading board game you play in your browser with friends or computer players. Roll the dice, buy properties, collect rent, trade and bid at auctions, and be the last player left standing. No download and no signup.</p>
        <div class="about-entry"><a class="cta-red about-play-link" href="/" data-home-tab="play">Play now</a><a class="btn-dark about-rules-link" href="/rules" data-top-surface="rules">Read the rules</a></div>
        <noscript><p class="about-static-note">This information works without JavaScript. Playing Poorup requires JavaScript.</p></noscript>
      </div>
      ${ticket}
    </header>
    <nav class="about-contents" aria-label="About sections"><a href="#about-project">The project</a><a href="#about-features">The game</a><a href="#about-credits">Credits</a><a href="#about-faq">Common questions</a></nav>
    <div class="about-reading panel">
      <section id="about-project" class="about-section" tabindex="-1" aria-labelledby="about-project-title">
        <div class="about-section-head"><div class="about-section-label t-micro ink-2">THE PROJECT</div><h2 id="about-project-title">A game night, without the setup.</h2></div>
        <div class="about-section-body">
          <p>Poorup is built to get friends around a table quickly. A browser, a name, and a room code are enough to start. Accounts are optional, and computer players can fill the empty seats.</p>
          <p class="about-pull" aria-hidden="true"><span>A browser, a name, and a room code are enough to start.</span></p>
          <p>The goal is a complete multiplayer property game where the next action is clear, the board stays at the center, and a lost connection does not mean losing your seat.</p>
          <div class="about-note"><span class="t-micro ink-2">INDEPENDENT BY DESIGN</span><p>Poorup is an independent project. It is not Monopoly and is not affiliated with Hasbro, the Monopoly brand or Richup.io; those names belong to their owners and are used here only to describe the kind of game Poorup is.</p></div>
        </div>
      </section>
      <section id="about-features" class="about-section" tabindex="-1" aria-labelledby="about-features-title">
        <div class="about-section-head"><div class="about-section-label t-micro ink-2">THE GAME</div><h2 id="about-features-title">Rent comes due.</h2></div>
        <div class="about-section-body">
          <p>Buy the block, collect the rent, and keep enough cash for the next corner. Poorup has its own board, cards, art, and rules.</p>
          <ul class="about-feature-list" role="list">${features}</ul>
        </div>
        <div class="about-turn">
          <h3 id="about-how-title">How a game of Poorup plays</h3>
          <ol class="about-steps" role="list" aria-labelledby="about-how-title">${steps}</ol>
        </div>
        <p class="about-rider">Know Monopoly or Richup.io? The dice will feel familiar. Computer players bid and trade under the same rules as everyone else.</p>
      </section>
      <section id="about-credits" class="about-section" tabindex="-1" aria-labelledby="about-credits-title">
        <div class="about-section-head"><div class="about-section-label t-micro ink-2">CREDITS</div><h2 id="about-credits-title">Type and soundtrack</h2></div>
        <div class="about-section-body">
          <div class="about-credit-row"><h3>Typography</h3><p><span class="about-face about-face-pixelify" translate="no">Pixelify Sans</span>, <span class="about-face about-face-jersey" translate="no">Jersey 15</span>, <span class="about-face about-face-silkscreen" translate="no">Silkscreen</span>, and <span class="about-face about-face-plex" translate="no">IBM Plex Mono</span>.</p></div>
          ${musicRow}
          <div class="about-credit-row"><h3>Explore Poorup</h3><ul class="about-links" role="list"><li><a href="/" data-home-tab="play">Take a seat</a></li><li><a href="/rules" data-top-surface="rules">Read the full rules</a></li><li><a href="/llms.txt">AI summary (llms.txt)</a></li></ul></div>
        </div>
      </section>
      <section id="about-faq" class="about-section" tabindex="-1" aria-labelledby="about-faq-title">
        <div class="about-section-head"><div class="about-section-label t-micro ink-2">COMMON QUESTIONS</div><h2 id="about-faq-title">Before you take a seat.</h2></div>
        <div class="about-section-body about-faq-list">${faq}</div>
      </section>
      <footer class="about-document-footer"><p>Poorup is a free browser game. Not affiliated with Hasbro, Monopoly or Richup.io.</p><a class="btn-dark" href="/" data-home-tab="play">Back to the parlor</a></footer>
    </div>
  </div>`;
}
