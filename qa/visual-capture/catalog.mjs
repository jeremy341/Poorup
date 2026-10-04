const modalSurfaceIds = [
  'board-standard-40', 'board-metro-52', 'purchase-choice-airport', 'live-auction', 'trade-offer-inbox', 'trade-builder',
  'deed-manager-property', 'deed-manager-airport', 'deed-manager-electric-company', 'deed-manager-water-company',
  'financing-builder-loan', 'emergency-bank-credit', 'wallet-account', 'wallet-items', 'market-desk',
  'casino-desk', 'player-profile-from-table', 'pending-deal-details', 'purchase-funding-request',
  'active-purchase-funding', 'bankruptcy-payment', 'voluntary-retirement', 'card-reveal-chance',
  'card-reveal-chest', 'card-gallery', 'confirm-deal-action', 'event-log-drawer', 'round-over',
  'account-sign-in-modal', 'achievement-detail-modal', 'rankings-overlay', 'social-overlay',
  'tile-airport', 'tile-chance', 'tile-earnings-tax', 'tile-electric-company', 'tile-go-to-prison',
  'tile-passing-by', 'tile-property', 'tile-start', 'tile-treasure-chest', 'tile-water-company', 'tile-vacation',
];

const gameUxSurfaceIds = [
  'dice-roll-total',
  'property-inspector', 'airport-inspector', 'electric-inspector', 'water-inspector',
  'property-manager', 'airport-manager', 'electric-manager', 'water-manager',
  'emergency-liquidity', 'trade-offer', 'deals-row-detail',
];

const releaseSurfaceIds = [
  'release-home', 'release-rankings-season', 'release-profile-statistics', 'release-profile-history-detail',
  'release-rules', 'release-market-desk', 'release-market-order-controls', 'release-airport-field',
  'release-global-event-announcement', 'release-global-event-warning', 'release-bankruptcy-decision',
  'release-human-spectator', 'release-end-game',
];

const adminSurfaceIds = [
  'admin-overview-initial', 'admin-overview', 'admin-match-health', 'admin-rulesets', 'admin-economy',
  'admin-events', 'admin-bots', 'admin-quality', 'admin-state-stale', 'admin-state-empty', 'admin-state-suppressed',
];

export const captureCatalog = Object.freeze([
  {
    group: 'pages',
    file: 'poorup.spec.js',
    testTitle: 'shared header and first content stay fixed and in view across top-level pages @ui-smoke',
    surfaceIds: ['home', 'rankings', 'social', 'rules', 'profile'],
  },
  {
    group: 'lobby',
    file: 'ipad-pro-modals.spec.js',
    testTitle: 'capture every in-game modal on supported landscape profiles',
    surfaceIds: ['room-browser', 'create-room-form', 'join-room-form', 'appearance-setup', 'waiting-lobby'],
  },
  {
    group: 'game',
    file: 'ipad-pro-modals.spec.js',
    testTitle: 'capture every in-game modal on supported landscape profiles',
    surfaceIds: modalSurfaceIds,
  },
  {
    group: 'game',
    file: 'in-game-ux.spec.js',
    testTitle: 'in-game tile, deed, trade, and credit surfaces fit landscape viewports',
    surfaceIds: gameUxSurfaceIds,
  },
  {
    group: 'game',
    file: 'release-surfaces.spec.js',
    testTitle: 'captures release surfaces across supported landscape profiles',
    surfaceIds: releaseSurfaceIds,
  },
  {
    group: 'admin',
    file: 'admin-analytics-visual.spec.js',
    testTitle: 'captures every tab and major data state for native inspection',
    surfaceIds: adminSurfaceIds,
  },
  {
    group: 'market',
    file: 'client-market-ui.spec.js',
    testTitle: 'market desk presents sector navigation, live shared quote, chart, and order ticket',
    surfaceIds: ['market-desk-responsive', 'market-desk-trade-ticket'],
  },
  {
    group: 'player',
    file: 'player-card-responsive.spec.js',
    testTitle: 'in-game player card stays compact at desktop and iPad sizes',
    surfaceIds: ['player-card-responsive'],
  },
  {
    group: 'funding',
    file: 'sponsored-purchase-presentation.spec.js',
    testTitle: 'funding request names its room-wide audience and preserves equity terms',
    surfaceIds: ['funding-request-equity', 'active-equity-offer'],
  },
]);

export const captureGroups = Object.freeze([...new Set(captureCatalog.map(entry => entry.group))].sort());

export function selectCaptureSuites(group = 'all') {
  if (group === 'all') return [...captureCatalog];
  if (!captureGroups.includes(group)) throw new Error(`Unknown capture group: ${group}`);
  return captureCatalog.filter(entry => entry.group === group);
}

export function expectedCaptureKeys(profileIds, group = 'all') {
  return selectCaptureSuites(group).flatMap(entry => profileIds.flatMap(profileId => entry.surfaceIds.map(surfaceId => `${profileId}/${entry.group}/${surfaceId}`)));
}
