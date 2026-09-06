/* ============================================================
   ACHIEVEMENT CATALOG (client-side definitions + local records)
   ============================================================ */
import { esc } from "./clientDom.js";
const ACHIEVEMENT_STORAGE_KEY = "poorup.achievements.v1";
const ACHIEVEMENTS = [
  { id: "first-deed", category: "visible", title: "FIRST DEED", short: "Buy your first property.", detail: "Purchase any property in a completed server game.", rarity: "COMMON" },
  { id: "full-street", category: "visible", title: "FULL STREET", short: "Complete a country group.", detail: "Own every property in one color group at the same time.", rarity: "UNCOMMON" },
  { id: "even-builder", category: "visible", title: "EVEN BUILDER", short: "Build without breaking the street.", detail: "Build a complete group while following every even-build rule.", rarity: "UNCOMMON" },
  { id: "auction-ghost", category: "visible", title: "AUCTION GHOST", short: "Win below the asking price.", detail: "Win an auction with a final bid below the deed’s listed price.", rarity: "RARE" },
  { id: "clean-exit", category: "visible", title: "CLEAN EXIT", short: "Repay a bank loan early.", detail: "Repay a bank loan in full before its due round.", rarity: "UNCOMMON" },
  { id: "collateral-damage", category: "visible", title: "COLLATERAL DAMAGE", short: "Learn what default costs.", detail: "Default on a bank loan and lose the collateral deed.", rarity: "RARE" },
  { id: "bad-idea-good-timing", category: "visible", title: "BAD IDEA, GOOD TIMING", short: "Borrow from the edge.", detail: "Take emergency bank credit with less than $50 cash and survive the game.", rarity: "RARE" },
  { id: "debt-free", category: "visible", title: "DEBT FREE", short: "Finish with clean books.", detail: "Complete a game with no active bank or player debt.", rarity: "UNCOMMON" },
  { id: "prison-break", category: "visible", title: "PRISON BREAK", short: "Use the card, then win.", detail: "Use a Get Out of Prison card and win the same game.", rarity: "RARE" },
  { id: "council-member", category: "global", title: "COUNCIL MEMBER", short: "Win a table election.", detail: "Cast the deciding vote in a City Election.", rarity: "UNCOMMON" },
  { id: "public-works", category: "global", title: "PUBLIC WORKS", short: "Build through policy.", detail: "Build on the group selected by a Public Works policy.", rarity: "RARE" },
  { id: "crisis-manager", category: "global", title: "CRISIS MANAGER", short: "Keep the table alive.", detail: "End a negative global event without going bankrupt.", rarity: "RARE" },
  { id: "bubble-survivor", category: "secret", title: "BUBBLE SURVIVOR", short: "Keep your deed through the crash.", clue: "A developed street can outlive the headline.", detail: "Own developed property when Housing Bubble Pop ends and keep the deed.", rarity: "EPIC", secret: true },
  { id: "short-the-street", category: "secret", title: "SHORT THE STREET", short: "Sell low, rebuild later.", clue: "Sometimes the best house is the one you sell first.", detail: "Sell a building during Housing Bubble Pop, then rebuild after recovery.", rarity: "EPIC", secret: true },
  { id: "no-floor", category: "secret", title: "NO FLOOR", short: "Survive the double crisis.", clue: "The market can lose its floor without taking your wallet.", detail: "Survive Foreclosure Spiral without taking a second bank loan.", rarity: "LEGENDARY", secret: true },
  { id: "moral-hazard", category: "secret", title: "MORAL HAZARD", short: "Take the rescue money.", clue: "A bailout feels different when you already owe the bank.", detail: "Receive a Bank Run bailout while holding an active loan.", rarity: "EPIC", secret: true },
  { id: "grounded-tourist", category: "secret", title: "GROUNDED TOURIST", short: "Travel without a flight.", clue: "The airport can be closed while the city keeps paying.", detail: "Own an airport during Airport Strike and still collect a non-airport rent.", rarity: "RARE", secret: true },
  { id: "stagflation-trader", category: "secret", title: "STAGFLATION TRADER", short: "Trade through the squeeze.", clue: "Make a deal while cash melts and debt grows.", detail: "Complete a trade during the Stagflation combination.", rarity: "EPIC", secret: true },
  { id: "compromised-council", category: "secret", title: "COMPROMISED COUNCIL", short: "Choose the least-worst policy.", clue: "The vote is not the scandal. The response is.", detail: "Vote in Legitimacy Crisis and choose the policy that ends the audit.", rarity: "LEGENDARY", secret: true },
  { id: "double-headline", category: "secret", title: "DOUBLE HEADLINE", short: "Trigger two crises.", clue: "One headline is luck. Two is a pattern.", detail: "Trigger two eligible global events through separate Surprise rolls in one game.", rarity: "LEGENDARY", secret: true },
  { id: "last-wallet-standing", category: "visible", title: "LAST WALLET STANDING", short: "Be the final player.", detail: "Win a server-authoritative game.", rarity: "COMMON" },
  { id: "no-refunds", category: "visible", title: "NO REFUNDS", short: "Win after the warning.", detail: "Win a game after reaching the bank-loan default warning.", rarity: "RARE" },
  { id: "generous-lender", category: "social", title: "GENEROUS LENDER", short: "Help someone across the gap.", detail: "Give a player loan that is fully repaid.", rarity: "UNCOMMON" },
  { id: "coalition-builder", category: "social", title: "COALITION BUILDER", short: "Turn opposition into leverage.", detail: "Complete a trade with a player you previously voted against.", rarity: "RARE" },
  { id: "unanimous", category: "social", title: "UNANIMOUS", short: "Get the whole table aligned.", detail: "Be part of an election where every active player selects the same policy.", rarity: "RARE" },
  { id: "patrol-rookie", category: "minigame", title: "PATROL ROOKIE", short: "Find your first rhythm.", detail: "Score 10 in Parlor Patrol.", rarity: "COMMON" },
  { id: "patrol-regular", category: "minigame", title: "PATROL REGULAR", short: "Stay on the radio.", detail: "Score 50 in Parlor Patrol.", rarity: "UNCOMMON" },
  { id: "patrol-ace", category: "minigame", title: "PATROL ACE", short: "Beat the street record.", detail: "Beat your saved personal best three times.", rarity: "RARE" },
  { id: "clean-run", category: "minigame", title: "CLEAN RUN", short: "No misses, no excuses.", detail: "Finish a patrol run without missing a target.", rarity: "EPIC" },
  { id: "rent-reaper", category: "visible", title: "RENT REAPER", short: "Collect from three players.", detail: "Collect rent from three different players in one round.", rarity: "RARE" },
  { id: "liquidity-king", category: "visible", title: "LIQUIDITY KING", short: "Own the cash table.", detail: "Finish a game with more cash than every other player combined.", rarity: "EPIC" },
  { id: "fire-sale", category: "global", title: "FIRE SALE", short: "Sell before the floor drops.", detail: "Sell three buildings during one global crisis.", rarity: "RARE" },
  { id: "airport-hopper", category: "visible", title: "AIRPORT HOPPER", short: "Visit every airport.", detail: "Visit all four airports in one game.", rarity: "UNCOMMON" },
  { id: "tax-evasion", category: "visible", title: "TAX EVASION", short: "Stay off the tax tiles.", detail: "Avoid every tax tile for an entire game.", rarity: "RARE" },
  { id: "underdog", category: "visible", title: "THE UNDERDOG", short: "Come back from last.", detail: "Win after being last in cash at the halfway point.", rarity: "RARE" },
  { id: "one-more-turn", category: "visible", title: "ONE MORE TURN", short: "Pay on the final cure round.", detail: "Survive a bank-loan warning and repay on the final cure round.", rarity: "EPIC" },
  { id: "group-therapy", category: "social", title: "GROUP THERAPY", short: "Trade across three deeds.", detail: "Complete a trade involving three different properties.", rarity: "UNCOMMON" },
  { id: "hostile-bidder", category: "visible", title: "HOSTILE BIDDER", short: "Win two auctions.", detail: "Win two auctions in one game.", rarity: "RARE" },
  { id: "empty-streets", category: "visible", title: "EMPTY STREETS", short: "Win without a full group.", detail: "Win while owning no complete property group.", rarity: "EPIC" },
  { id: "event-tourist", category: "global", title: "EVENT TOURIST", short: "Collect disasters.", detail: "Experience three different global events across your account history.", rarity: "RARE" },
  { id: "public-enemy", category: "global", title: "PUBLIC ENEMY", short: "Survive the investigation vote.", detail: "Win an Anti-Monopoly Investigation vote against yourself.", rarity: "LEGENDARY" },
  { id: "silent-partner", category: "social", title: "SILENT PARTNER", short: "Lend without collateral.", detail: "Complete a player-loan contract without owning the collateral.", rarity: "RARE" },
  { id: "treasure-map", category: "visible", title: "TREASURE MAP", short: "Find every chest card.", detail: "Draw every Treasure card at least once across your account history.", rarity: "EPIC" },
  { id: "one-dollar-hedge", category: "global", title: "ONE DOLLAR HEDGE", short: "Bet the smallest stake.", detail: "Place a one-dollar roulette bet.", rarity: "COMMON" },
  { id: "roulette-regular", category: "global", title: "ROULETTE REGULAR", short: "Keep spinning.", detail: "Place eight roulette bets in one game.", rarity: "RARE" },
  { id: "all-in", category: "global", title: "ALL IN", short: "Risk the whole stack.", detail: "Place a roulette stake equal to your available capital.", rarity: "EPIC" },
  { id: "first-index", category: "global", title: "FIRST INDEX", short: "Enter the exchange.", detail: "Buy your first fictional market index unit.", rarity: "COMMON" },
  { id: "market-maker", category: "global", title: "MARKET MAKER", short: "Trade through the noise.", detail: "Complete ten market orders in one game.", rarity: "RARE" },
  { id: "crisis-investor", category: "global", title: "CRISIS INVESTOR", short: "Buy the fear discount.", detail: "Buy a market index while a negative global event is active and sell it for a profit after recovery.", rarity: "EPIC" },
  { id: "41st-tile", category: "secret", title: "THE 41ST TILE", short: "Step outside the board.", clue: "There are forty tiles. You stepped on one more.", detail: "Trigger the hidden movement sequence, then win the game.", rarity: "MYTHICAL", secret: true },
  { id: "null-player", category: "secret", title: "THE NULL PLAYER", short: "Continue from nothing.", clue: "Your wallet was empty. The turn continued. The table refuses to remember why.", detail: "Reach exactly $0, avoid bankruptcy, complete another turn, and win.", rarity: "MYTHICAL", secret: true },
  { id: "black-ledger", category: "secret", title: "THE BLACK LEDGER", short: "Close the book yourself.", clue: "The bank closed the book. Something inside kept counting.", detail: "Survive a curated crisis combination after losing collateral, then win.", rarity: "MYTHICAL", secret: true },
];

function isKnownAchievement(id) {
  return ACHIEVEMENTS.some((achievement) => achievement.id === id);
}

function addLegacyIds(raw, records) {
  raw.forEach((id) => {
    if (isKnownAchievement(id)) records.set(id, null);
  });
}

function addRecordEntries(source, records) {
  Object.entries(source).forEach(([id, unlockedAt]) => {
    const stamp = typeof unlockedAt === "string" ? unlockedAt : null;
    if (isKnownAchievement(id)) records.set(id, stamp);
  });
}

function recordsSource(raw) {
  const nested = raw?.records;
  if (typeof nested === "object" && nested !== null) return nested;
  return raw;
}

function loadAchievementRecords() {
  try {
    const raw = JSON.parse(localStorage.getItem(ACHIEVEMENT_STORAGE_KEY) || "{}");
    const records = new Map();
    if (Array.isArray(raw)) {
      addLegacyIds(raw, records);
      return records;
    }
    addRecordEntries(recordsSource(raw) || {}, records);
    return records;
  } catch { return new Map(); }
}

function achievementIconHTML(id) {
  return `<svg class="achievement-icon" viewBox="0 0 32 32" aria-hidden="true" focusable="false"><use href="/assets/achievements.svg#achievement-${esc(id)}"></use></svg>`;
}

export { ACHIEVEMENTS, ACHIEVEMENT_STORAGE_KEY, loadAchievementRecords, achievementIconHTML };