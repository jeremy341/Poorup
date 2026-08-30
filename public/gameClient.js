function generateBoardPositions() {
  const positions = [];
  const boardSize = 1180;
  const cornerCenter = 70;
  const lastCornerCenter = boardSize - cornerCenter;
  const sideCenters = Array.from({ length: 9 }, (_, index) => 190 + (index * 100));
  const toPercent = value => Number(((value / boardSize) * 100).toFixed(2));
  const pushPosition = (left, top) => {
    positions.push({ left: toPercent(left), top: toPercent(top) });
  };

  pushPosition(cornerCenter, cornerCenter);
  sideCenters.forEach(left => pushPosition(left, cornerCenter));
  pushPosition(lastCornerCenter, cornerCenter);
  sideCenters.forEach(top => pushPosition(lastCornerCenter, top));
  pushPosition(lastCornerCenter, lastCornerCenter);
  sideCenters.slice().reverse().forEach(left => pushPosition(left, lastCornerCenter));
  pushPosition(cornerCenter, lastCornerCenter);
  sideCenters.slice().reverse().forEach(top => pushPosition(cornerCenter, top));

  return positions;
}

const BOARD_POSITIONS = generateBoardPositions();
const TOKEN_SIZE = 30;

const PLAYER_COLORS = [
  '#111827', '#ef4444', '#f59e0b', '#84cc16', '#06b6d4', '#6366f1', '#a78bfa', '#fb7185'
];
const COLOR_NAMES = {
  '#111827': 'Charcoal',
  '#ef4444': 'Red',
  '#f59e0b': 'Amber',
  '#84cc16': 'Lime',
  '#06b6d4': 'Cyan',
  '#6366f1': 'Indigo',
  '#a78bfa': 'Lavender',
  '#fb7185': 'Rose'
};
const AUCTION_DURATION_MS = 5000;
const AUCTION_PRESS_DELAY_MS = 300;

function initGameClient() {
  const elements = {
    landingScreen: document.getElementById('landing-screen'),
    mainWorkspace: document.getElementById('main-workspace'),
    landingForm: document.getElementById('landing-form'),
    nicknameInput: document.getElementById('nickname-input'),
    roomCodeInput: document.getElementById('room-code-input'),
    createBtn: document.getElementById('create-btn'),
    joinBtn: document.getElementById('join-btn'),
    chatMessages: document.getElementById('chat-messages'),
    chatInput: document.getElementById('chat-input'),
    colorGrids: document.querySelectorAll('.color-grid'),
    setupOverlay: document.getElementById('setup-overlay'),
    overlayContinueBtn: document.getElementById('overlay-continue-btn'),
    boardPanel: document.querySelector('.board-panel'),
    boardImage: document.getElementById('board-image'),
    playerList: document.getElementById('player-list'),
    roomCodeBlock: document.getElementById('room-code'),
    roomCodeValue: document.getElementById('room-code-value'),
    copyRoomBtn: document.getElementById('copy-room-btn'),
    turnBanner: document.getElementById('turn-banner'),
    turnBannerTitle: document.getElementById('turn-banner-title'),
    turnBannerSubtitle: document.getElementById('turn-banner-subtitle'),
    diceDisplay: document.getElementById('dice-display'),
    vacationDisplay: document.getElementById('vacation-display'),
    vacationBalance: document.getElementById('vacation-balance'),
    boardOwnershipLayer: document.getElementById('board-ownership-layer'),
    rightSidebar: document.querySelector('.right-panel'),
    propertiesWindow: document.querySelector('.properties-panel'),
    settingsWindow: document.getElementById('settings-window'),
    purchaseModal: document.getElementById('purchase-modal'),
    purchaseName: document.getElementById('purchase-property-name'),
    purchaseCost: document.getElementById('purchase-property-cost'),
    purchaseModalNote: document.getElementById('purchase-modal-note'),
    purchaseConfirmBtn: document.getElementById('purchase-confirm-btn'),
    purchaseDeclineBtn: document.getElementById('purchase-decline-btn'),
    auctionModal: document.getElementById('auction-modal'),
    auctionModalCard: document.querySelector('#auction-modal .auction-modal-card'),
    auctionPropertyName: document.getElementById('auction-property-name'),
    auctionCurrentBid: document.getElementById('auction-current-bid'),
    auctionCountdown: document.getElementById('auction-countdown'),
    auctionMeterFill: document.getElementById('auction-meter-fill'),
    auctionStatus: document.getElementById('auction-status'),
    auctionBid2Btn: document.getElementById('auction-bid-2-btn'),
    auctionBid10Btn: document.getElementById('auction-bid-10-btn'),
    auctionBid100Btn: document.getElementById('auction-bid-100-btn'),
    propertyModal: document.getElementById('property-modal'),
    propertyModalName: document.getElementById('property-modal-name'),
    propertyModalGroup: document.getElementById('property-modal-group'),
    propertyModalStatus: document.getElementById('property-modal-status'),
    propertyModalCurrentRent: document.getElementById('property-modal-current-rent'),
    propertyModalRents: document.getElementById('property-modal-rents'),
    propertyModalHouses: document.getElementById('property-modal-houses'),
    propertyModalNote: document.getElementById('property-modal-note'),
    propertyBuildBtn: document.getElementById('property-build-btn'),
    propertySellBtn: document.getElementById('property-sell-btn'),
    propertyMortgageBtn: document.getElementById('property-mortgage-btn'),
    propertyCloseBtn: document.getElementById('property-close-btn'),
    tradePlayerList: document.getElementById('trade-player-list'),
    tradeWindow: document.getElementById('trade-window'),
    tradeModal: document.getElementById('trade-modal'),
    tradeOfferCash: document.getElementById('trade-offer-cash'),
    tradeRequestCash: document.getElementById('trade-request-cash'),
    tradeOfferCashTotal: document.getElementById('trade-offer-cash-total'),
    tradeRequestCashTotal: document.getElementById('trade-request-cash-total'),
    tradeTargetTitle: document.getElementById('trade-target-title'),
    tradeOfferProperties: document.getElementById('trade-offer-properties'),
    tradeRequestProperties: document.getElementById('trade-request-properties'),
    tradeSendBtn: document.getElementById('trade-send-btn'),
    tradeCloseBtn: document.getElementById('trade-close-btn'),
    incomingTradeModal: document.getElementById('incoming-trade-modal'),
    incomingTradeSummary: document.getElementById('incoming-trade-summary'),
    incomingTradeDetails: document.getElementById('incoming-trade-details'),
    incomingTradeAcceptBtn: document.getElementById('incoming-trade-accept-btn'),
    incomingTradeDeclineBtn: document.getElementById('incoming-trade-decline-btn'),

    centerStartBtn: document.getElementById('center-start-btn'),
    startGameOverlay: document.getElementById('start-game-overlay'),
    rollDiceBtn: document.getElementById('roll-dice-btn'),
    payJailBtn: document.getElementById('pay-jail-btn'),
    declareBankruptcyBtn: document.getElementById('declare-bankruptcy-btn'),
    endTurnBtn: document.getElementById('end-turn-btn'),
    turnActions: document.getElementById('turn-actions'),
    myCashDisplay: document.getElementById('my-cash-display'),
    myCashValue: document.getElementById('my-cash-value'),
    activeRulesStrip: document.getElementById('active-rules-strip'),
    gameFeedPanel: document.getElementById('game-feed-panel'),
    gameFeedList: document.getElementById('game-feed-list'),
    purchaseMyCash: document.getElementById('purchase-my-cash'),
    winnerModal: document.getElementById('winner-modal'),
    winnerModalMessage: document.getElementById('winner-modal-message'),
    winnerCloseBtn: document.getElementById('winner-close-btn'),
    myPropertiesList: document.getElementById('my-properties-list'),
    helpBtn: document.getElementById('help-btn'),
    helpModal: document.getElementById('help-modal'),
    helpCloseBtn: document.getElementById('help-close-btn'),
    toastStack: document.getElementById('toast-stack')
  };

  const required = [
    'landingScreen', 'mainWorkspace', 'landingForm', 'nicknameInput', 'roomCodeInput',
    'chatMessages', 'chatInput', 'boardPanel', 'boardImage', 'playerList',
    'rollDiceBtn', 'endTurnBtn', 'turnActions'
  ];

  for (const key of required) {
    if (!elements[key]) {
      console.error(`Missing required UI element: ${key}`);
      return () => {};
    }
  }

  const settingsInputs = Array.from(
    document.querySelectorAll('.setting-toggle input, .custom-select[data-setting]')
  );

  let selectedColor = PLAYER_COLORS[5];
  let currentPurchase = null;
  const localState = {
    room: null,
    game: null,
    clientId: getClientId(),
    isHost: false,
    currentPlayerIsMe: false
  };
  const gameState = {
    started: false,
    currentPlayerId: null,
    lastDice: [0, 0],
    hasRolled: false,
    auctionActive: false,
    awaitingDecision: false,
    extraRollPending: false,
    pendingTrade: null,
    selectedPropertyIndex: null
  };
  let localRollPending = false;
  let hadConnectionLoss = false;
  let lastShownWinner = null;
  let auctionUiState = null;
  let auctionUiGame = null;
  let auctionUiTicker = null;
  let auctionUiPressLockUntil = 0;
  let serverTimeOffset = 0;
  let propertyUiState = null;
  let tradeUiState = {
    targetPlayerId: null,
    selectedOfferPropertyIndexes: new Set(),
    selectedRequestPropertyIndexes: new Set(),
    offerCash: 0,
    requestCash: 0
  };

  function getServerNow() {
    return Date.now() + serverTimeOffset;
  }

  const socket = io();
  const disposers = [];

  function on(target, event, handler, options) {
    target.addEventListener(event, handler, options);
    disposers.push(() => target.removeEventListener(event, handler, options));
  }

  function getClientId() {
    const storageKey = 'poorup-client-id';
    try {
      const existing = window.sessionStorage.getItem(storageKey);
      if (existing) {
        return existing;
      }
      const namePrefix = 'poorup-client-id:';
      if (window.name && window.name.startsWith(namePrefix)) {
        const fromName = window.name.slice(namePrefix.length);
        window.sessionStorage.setItem(storageKey, fromName);
        return fromName;
      }
      const generated = typeof crypto !== 'undefined' && crypto.randomUUID
        ? `client-${crypto.randomUUID()}`
        : `client-${Math.random().toString(36).slice(2, 11)}`;
      window.sessionStorage.setItem(storageKey, generated);
      return generated;
    } catch (error) {
      const namePrefix = 'poorup-client-id:';
      if (window.name && window.name.startsWith(namePrefix)) {
        return window.name.slice(namePrefix.length);
      }
      const generated = typeof crypto !== 'undefined' && crypto.randomUUID
        ? `client-${crypto.randomUUID()}`
        : `client-${Math.random().toString(36).slice(2, 11)}`;
      window.name = `${namePrefix}${generated}`;
      return generated;
    }
  }

  function escapeHtml(text) {
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function emit(event, payload = {}, callback) {
    const data = { ...payload, clientId: localState.clientId };
    if (callback) socket.emit(event, data, callback);
    else socket.emit(event, data);
  }

  function appendChat(text, who = 'System') {
    const line = document.createElement('div');
    line.className = 'chat-line';
    line.textContent = who ? `${who}: ${text}` : text;
    elements.chatMessages.appendChild(line);
    elements.chatMessages.scrollTop = elements.chatMessages.scrollHeight;
  }

  function formatDice(lastDice) {
    if (!Array.isArray(lastDice) || lastDice.length !== 2) {
      return 'Dice: --';
    }
    const [a, b] = lastDice;
    if (!a && !b) return 'Dice: --';
    return `Dice: ${a + b}`;
  }

  function showToast(text, type = 'info') {
    if (!elements.toastStack) return;
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = text;
    elements.toastStack.appendChild(toast);
    window.setTimeout(() => {
      toast.remove();
    }, 3500);
  }

  function showOverlay() {
    elements.setupOverlay?.classList.remove('hidden');
    elements.boardPanel.classList.add('blurred');
  }

  function hideOverlay() {
    elements.setupOverlay?.classList.add('hidden');
    elements.boardPanel.classList.remove('blurred');
  }

  function showWorkspace() {
    elements.landingScreen.classList.add('hidden');
    elements.mainWorkspace.classList.remove('hidden');
  }

  function setRoomCode(code) {
    if (!elements.roomCodeBlock || !elements.roomCodeValue) return;
    if (!code) {
      elements.roomCodeBlock.classList.add('hidden');
      return;
    }
    elements.roomCodeValue.textContent = code;
    elements.roomCodeBlock.classList.remove('hidden');
  }

  function showModal(modal) {
    if (!modal) return;
    if (modal._hideTimer) {
      clearTimeout(modal._hideTimer);
      modal._hideTimer = null;
    }
    modal.classList.remove('hidden');
    modal.offsetWidth;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        modal.classList.add('is-visible');
      });
    });
  }

  function hideModal(modal) {
    if (!modal) return;
    modal.classList.remove('is-visible');
    if (modal._hideTimer) clearTimeout(modal._hideTimer);
    modal._hideTimer = window.setTimeout(() => {
      modal.classList.add('hidden');
      modal._hideTimer = null;
    }, 160);
  }
  function stopAuctionTicker() {
    if (auctionUiTicker) {
      clearInterval(auctionUiTicker);
      auctionUiTicker = null;
    }
  }

  function getAuctionBidLockMessage(auction, localPlayer, now, canAffordAny) {
    if (!auction || !localPlayer) return 'You can place the next bid.';
    if (auction.cooldownUntil && now < auction.cooldownUntil) {
      return 'Hold on a moment before bidding again.';
    }
    if (auction.highestBid > 0 && auction.highestBidderId === localPlayer.id) {
      return 'Wait for another player to raise the bid.';
    }
    if (!canAffordAny) {
      return 'You cannot afford any of the bid steps.';
    }
    return 'Choose a bid step to raise the offer.';
  }

  function getAuctionLeaderLabel(auction, game) {
    if (!auction?.highestBidderId) {
      return 'No bids yet';
    }
    const leader = game?.players?.find(player => player.id === auction.highestBidderId);
    return leader ? `${leader.nickname} leads` : 'Current leader';
  }

  function formatMoney(amount) {
    return `$${Math.max(0, Math.round(Number(amount) || 0))}`;
  }

  function getPropertyHouseCost(tile) {
    const costs = {
      Brown: 50,
      'Light Blue': 50,
      Pink: 100,
      Orange: 100,
      Red: 150,
      Yellow: 150,
      Green: 200,
      'Dark Blue': 200
    };
    return costs[tile?.group] || 0;
  }

  function formatRentPreview(value) {
    if (typeof value === 'string') return value;
    return formatMoney(value);
  }

  function getRentPreview(tile, level, ownerHasFullSet = false, game = null, settings = null) {
    const baseRent = tile?.rent || 0;
    if (!tile || tile.mortgaged) return 0;
    if (tile.type === "utility") {
      const lastDice = game?.lastDice;
      if (Array.isArray(lastDice) && lastDice.length === 2 && (lastDice[0] || lastDice[1])) {
        const diceTotal = Math.max(2, lastDice[0] + lastDice[1]);
        const owner = game?.players?.find(player => player.id === tile.ownerId);
        const ownedUtilities = (game?.tiles || []).filter(entry => entry.type === "utility" && entry.ownerId === owner?.id).length;
        const utilityCount = Math.min(Math.max(level || ownedUtilities || 1, 1), 2);
        return diceTotal * (utilityCount >= 2 ? 10 : 4);
      }
      return "Varies by dice roll";
    }
    if (tile.type === "railroad") {
      const owner = game?.players?.find(player => player.id === tile.ownerId);
      const ownedRailroads = (game?.tiles || []).filter(entry => entry.type === "railroad" && entry.ownerId === owner?.id).length;
      const tiers = [25, 50, 100, 200];
      const railroadCount = Math.min(Math.max(level || ownedRailroads || 1, 1), tiers.length);
      return tiers[railroadCount - 1];
    }
    const multipliers = [1, 5, 15, 45, 80, 125];
    if (level > 0) {
      return Math.floor(baseRent * multipliers[Math.min(level, multipliers.length - 1)]);
    }
    const roomSettings = settings || localState.room?.settings || {};
    const doubleBase = ownerHasFullSet && roomSettings.doubleRent;
    return doubleBase ? baseRent * 2 : baseRent;
  }

  function canBuildOnTileClient(player, tile, game, settings) {
    if (!player || !tile || tile.type !== 'property') return false;
    if (tile.ownerId !== player.id || tile.mortgaged) return false;
    const groupTiles = (game?.tiles || []).filter(entry => entry.group === tile.group && entry.type === 'property' && entry.ownerId === player.id);
    const fullGroup = (game?.tiles || []).filter(entry => entry.group === tile.group && entry.type === 'property');
    if (!groupTiles.length || groupTiles.length !== fullGroup.length) return false;
    if (groupTiles.some(entry => entry.mortgaged)) return false;
    if (!settings?.evenBuild) {
      return (tile.houseCount || 0) < 5;
    }
    const houseLevels = groupTiles.map(entry => entry.houseCount || 0);
    const minLevel = Math.min(...houseLevels);
    return (tile.houseCount || 0) === minLevel && (tile.houseCount || 0) < 5;
  }

  function canSellFromTileClient(player, tile, game, settings) {
    if (!player || !tile || tile.type !== 'property') return false;
    if (tile.ownerId !== player.id) return false;
    const groupTiles = (game?.tiles || []).filter(entry => entry.group === tile.group && entry.type === 'property' && entry.ownerId === player.id);
    if (!groupTiles.length) return false;
    if (!settings?.evenBuild) {
      return (tile.houseCount || 0) > 0;
    }
    const houseLevels = groupTiles.map(entry => entry.houseCount || 0);
    const maxLevel = Math.max(...houseLevels);
    return (tile.houseCount || 0) === maxLevel && (tile.houseCount || 0) > 0;
  }

  function setLandingBusy(busy) {
    if (elements.joinBtn) elements.joinBtn.disabled = busy;
    if (elements.createBtn) elements.createBtn.disabled = busy;
  }

  function isTradeableTile(tile) {
    return Boolean(tile && (tile.type === 'property' || tile.type === 'utility' || tile.type === 'railroad') && !tile.mortgaged && (tile.houseCount || 0) === 0);
  }

  function canPlaceAuctionBid(auction, localPlayer, now, step) {
    if (!auction?.active) return false;
    if (!localPlayer || localPlayer.bankrupt || localPlayer.disconnected) return false;
    if (auction.cooldownUntil && now < auction.cooldownUntil) return false;
    if (now < auctionUiPressLockUntil) return false;
    if (auction.highestBid > 0 && auction.highestBidderId === localPlayer.id) return false;
    if (Number.isFinite(step) && localPlayer.cash < (auction.highestBid || 0) + step) return false;
    return true;
  }

  function refreshAuctionUi() {
    if (!auctionUiState || !auctionUiGame || !elements.auctionModal || elements.auctionModal.classList.contains('hidden')) {
      return;
    }

    const auction = auctionUiState;
    const now = getServerNow();
    const remainingMs = Math.max(0, (auction.endsAt || (now + AUCTION_DURATION_MS)) - now);
    const totalMs = auction.durationMs || AUCTION_DURATION_MS;
    const percent = totalMs > 0 ? Math.max(0, Math.min(1, remainingMs / totalMs)) : 0;
    const seconds = (remainingMs / 1000).toFixed(1);
    const isCritical = remainingMs <= 1500;
    const localPlayer = auctionUiGame?.players?.find(player => player.clientId === localState.clientId);
    const canBid2 = canPlaceAuctionBid(auction, localPlayer, now, 2);
    const canBid10 = canPlaceAuctionBid(auction, localPlayer, now, 10);
    const canBid100 = canPlaceAuctionBid(auction, localPlayer, now, 100);
    const canAffordAny = canBid2 || canBid10 || canBid100;

    if (elements.auctionCountdown) {
      elements.auctionCountdown.textContent = `${seconds}s left`;
    }
    if (elements.auctionMeterFill) {
      elements.auctionMeterFill.style.transform = `scaleX(${percent})`;
    }
    if (elements.auctionModalCard) {
      elements.auctionModalCard.classList.toggle('is-critical', isCritical);
    }
    if (elements.auctionCurrentBid) {
      elements.auctionCurrentBid.textContent = `Current bid: $${auction.highestBid || 0}`;
    }
    if (elements.auctionStatus) {
      const leader = getAuctionLeaderLabel(auction, auctionUiGame);
      elements.auctionStatus.textContent = `${leader} • ${getAuctionBidLockMessage(auction, localPlayer, now, canAffordAny)}`;
    }
    if (elements.auctionBid2Btn) elements.auctionBid2Btn.disabled = !canBid2;
    if (elements.auctionBid10Btn) elements.auctionBid10Btn.disabled = !canBid10;
    if (elements.auctionBid100Btn) elements.auctionBid100Btn.disabled = !canBid100;
  }

  function startAuctionTicker() {
    stopAuctionTicker();
    refreshAuctionUi();
    auctionUiTicker = setInterval(refreshAuctionUi, 100);
  }

  function syncAppearanceSelection(color, nickname) {
    return new Promise(resolve => {
      emit('set-player-appearance', { color, nickname }, response => {
        resolve(Boolean(response?.success));
      });
    });
  }

  function applyLocalColorPreview(color) {
    const preferredCard = localState.clientId
      ? elements.playerList.querySelector(`[data-client-id="${localState.clientId}"] .player-avatar`)
      : null;
    const fallbackCard = elements.playerList.querySelector('.player-card .player-avatar');
    const localCard = preferredCard || fallbackCard;
    if (localCard) localCard.style.background = color;

    const preferredToken = localState.clientId
      ? document.querySelector(`#token-layer [data-client-id="${localState.clientId}"]`)
      : null;
    const fallbackToken = document.querySelector('#token-layer .player-token');
    const localToken = preferredToken || fallbackToken;
    if (localToken) localToken.style.background = color;
  }

  function getPlayerColor(player) {
    return player?.color || '#84cc16';
  }

  function setPlayerList(players, currentPlayerId, turnOrder) {
    elements.playerList.innerHTML = '';
    if (!players.length) {
      elements.playerList.textContent = 'No players yet';
      return;
    }

    const orderedPlayers = [...players];
    if (turnOrder?.length) {
      orderedPlayers.sort((a, b) => {
        const aIndex = turnOrder.indexOf(a.id);
        const bIndex = turnOrder.indexOf(b.id);
        if (aIndex === -1) return 1;
        if (bIndex === -1) return -1;
        return aIndex - bIndex;
      });
    }

    orderedPlayers.forEach(player => {
      const card = document.createElement('div');
      const isActive = player.id === currentPlayerId;
      const isMe = player.clientId === localState.clientId;
      const status = player.bankrupt
        ? 'Bankrupt'
        : player.disconnected
          ? 'Away'
          : (gameState.started ? 'Playing' : 'Ready');
      card.className = [
        'player-card',
        isActive ? 'active' : '',
        isMe ? 'is-me' : '',
        player.bankrupt ? 'bankrupt' : '',
        player.disconnected ? 'away' : ''
      ].filter(Boolean).join(' ');
      card.dataset.clientId = player.clientId || '';
      const avatarColor = getPlayerColor(player);
      card.innerHTML = `
        <div class="player-avatar" style="background:${avatarColor}"></div>
        <div class="player-info">
          <div class="player-name">${escapeHtml(player.nickname)}${player.isHost ? ' • Host' : ''}</div>
          <div class="player-meta">$${player.cash} • ${status}</div>
          <div class="player-badges">
            ${player.inJail ? '<span class="player-badge">In Jail</span>' : ''}
            ${isActive ? '<span class="player-badge">Current Turn</span>' : ''}
            ${player.disconnected ? '<span class="player-badge">Disconnected</span>' : ''}
          </div>
        </div>
      `;
      elements.playerList.appendChild(card);
    });
  }

  function updateTurnButtons() {
    const localPlayer = localState.game?.players?.find(player => player.clientId === localState.clientId);
    const pendingPayment = localState.game?.pendingPayment;
    const owesDebt = Boolean(
      pendingPayment &&
      localPlayer &&
      pendingPayment.playerId === localPlayer.id
    );

    if (!gameState.started) {
      elements.rollDiceBtn.classList.add('hidden');
      elements.endTurnBtn.classList.add('hidden');
      elements.payJailBtn?.classList.add('hidden');
      elements.declareBankruptcyBtn?.classList.add('hidden');
      elements.turnActions.classList.add('hidden');
      return;
    }

    if (owesDebt) {
      elements.rollDiceBtn.classList.add('hidden');
      elements.endTurnBtn.classList.add('hidden');
      elements.payJailBtn?.classList.add('hidden');
      elements.declareBankruptcyBtn?.classList.remove('hidden');
      elements.turnActions.classList.remove('hidden');
      return;
    }

    elements.declareBankruptcyBtn?.classList.add('hidden');

    if (!localState.currentPlayerIsMe || gameState.auctionActive || gameState.awaitingDecision) {
      elements.rollDiceBtn.classList.add('hidden');
      elements.endTurnBtn.classList.add('hidden');
      elements.payJailBtn?.classList.add('hidden');
      elements.turnActions.classList.add('hidden');
      return;
    }

    elements.rollDiceBtn.classList.remove('hidden');
    elements.endTurnBtn.classList.toggle('hidden', Boolean(gameState.extraRollPending));
    elements.turnActions.classList.remove('hidden');
    const canRoll = !localRollPending && (!gameState.hasRolled || gameState.extraRollPending);
    elements.rollDiceBtn.disabled = !canRoll;
    const canEndTurn = gameState.hasRolled && !gameState.extraRollPending;
    elements.endTurnBtn.disabled = !canEndTurn;

    const showJailPay = Boolean(localPlayer?.inJail && !gameState.hasRolled);
    if (elements.payJailBtn) {
      elements.payJailBtn.classList.toggle('hidden', !showJailPay);
      elements.payJailBtn.disabled = !showJailPay || (localPlayer?.cash || 0) < 50;
    }
  }

  function setTurnBanner(game, vacationPool = 0) {
    if (elements.vacationBalance) {
      elements.vacationBalance.textContent = formatMoney(vacationPool);
    }
    if (!game?.started) {
      const waitingText = localState.isHost
        ? 'You are the host.'
        : 'Waiting for the host to start the game.';
      if (elements.turnBannerTitle) elements.turnBannerTitle.textContent = 'Lobby';
      if (elements.turnBannerSubtitle) elements.turnBannerSubtitle.textContent = waitingText;
      if (elements.diceDisplay) elements.diceDisplay.textContent = 'Dice: --';
      if (elements.vacationDisplay) elements.vacationDisplay.textContent = `Vacation: ${formatMoney(vacationPool)}`;
      elements.rollDiceBtn.classList.add('hidden');
      elements.endTurnBtn.classList.add('hidden');
      elements.turnActions.classList.add('hidden');
      return;
    }

    const current = game.players.find(player => player.id === game.currentPlayerId);
    const localPlayer = game.players.find(player => player.clientId === localState.clientId);
    localState.currentPlayerIsMe = Boolean(
      current && localPlayer && current.id === localPlayer.id
    );
    if (elements.turnBannerTitle) {
      if (current?.disconnected) {
        elements.turnBannerTitle.textContent = `Waiting for ${current.nickname}`;
      } else {
        elements.turnBannerTitle.textContent = current
          ? (localState.currentPlayerIsMe ? 'Your turn' : `${current.nickname}'s turn`)
          : 'Game in progress';
      }
    }
    if (elements.turnBannerSubtitle) {
      let subtitle;
      if (current?.disconnected) {
        subtitle = 'Waiting for them to reconnect…';
      } else if (localState.currentPlayerIsMe) {
        subtitle = gameState.extraRollPending
          ? 'Roll again. Doubles gave you an extra turn.'
          : 'Roll the dice, resolve the tile, then end your turn.';
      } else {
        subtitle = 'Watch the active player and wait for your turn.';
      }
      elements.turnBannerSubtitle.textContent = subtitle;
    }
    if (elements.diceDisplay) {
      elements.diceDisplay.textContent = formatDice(game.lastDice);
    }
    if (elements.vacationDisplay) {
      elements.vacationDisplay.textContent = `Vacation: ${formatMoney(vacationPool)}`;
    }
    if (elements.myCashDisplay && elements.myCashValue) {
      if (game?.started && localPlayer) {
        elements.myCashDisplay.classList.remove('hidden');
        const pendingPayment = game.pendingPayment;
        const owesDebt = pendingPayment?.playerId === localPlayer.id;
        const cashLabel = formatMoney(localPlayer.cash);
        elements.myCashValue.textContent = owesDebt
          ? `${cashLabel} · Owe ${formatMoney(pendingPayment.amountRemaining)}`
          : cashLabel;
      } else {
        elements.myCashDisplay.classList.add('hidden');
      }
    }
    if (localState.currentPlayerIsMe && localPlayer?.inJail && elements.turnBannerSubtitle && !game?.pendingPayment) {
      const jailTurns = localPlayer.jailTurns || 0;
      elements.turnBannerSubtitle.textContent = `In jail — roll doubles, pay $50, or wait (turn ${jailTurns}/3).`;
    }
    const pendingPayment = game?.pendingPayment;
    if (pendingPayment?.playerId === localPlayer?.id && elements.turnBannerSubtitle) {
      elements.turnBannerSubtitle.textContent = `You owe ${formatMoney(pendingPayment.amountRemaining)}. Mortgage or sell buildings, or declare bankruptcy.`;
    }
    updateTurnButtons();
  }

  function renderActiveRules(settings) {
    if (!elements.activeRulesStrip) return;
    if (!settings || !gameState.started) {
      elements.activeRulesStrip.classList.add('hidden');
      elements.activeRulesStrip.textContent = '';
      return;
    }
    const labels = [];
    if (settings.doubleRent) labels.push('Double rent');
    if (settings.vacationCash) labels.push('Vacation cash');
    if (settings.auction) labels.push('Auctions');
    if (settings.evenBuild) labels.push('Even build');
    if (settings.mortgage) labels.push('Mortgage');
    if (settings.randomizePlayerOrder) labels.push('Random order');
    if (settings.noRentWhileInPrison) labels.push('No rent in jail');
    elements.activeRulesStrip.textContent = labels.length
      ? `Active rules: ${labels.join(' • ')}`
      : 'Standard rules';
    elements.activeRulesStrip.classList.remove('hidden');
  }

  function renderGameFeed(feed) {
    if (!elements.gameFeedPanel || !elements.gameFeedList) return;
    if (!gameState.started || !Array.isArray(feed) || !feed.length) {
      elements.gameFeedPanel.classList.add('hidden');
      elements.gameFeedList.innerHTML = '';
      return;
    }
    elements.gameFeedPanel.classList.remove('hidden');
    elements.gameFeedList.innerHTML = feed
      .slice(0, 20)
      .map(entry => `<div class="game-feed-item">${escapeHtml(entry.text)}</div>`)
      .join('');
  }

  function maybeShowWinnerModal(game, room) {
    if (!elements.winnerModal || !elements.winnerModalMessage) return;
    const winner = game?.lastWinner;
    if (!winner || room?.started) return;
    const key = `${winner.id}-${winner.nickname}`;
    if (lastShownWinner === key) return;
    lastShownWinner = key;
    elements.winnerModalMessage.textContent = `${winner.nickname} wins the game!`;
    showModal(elements.winnerModal);
  }

  function renderBoardOwnership(tiles, players) {
    if (!elements.boardOwnershipLayer) return;

    elements.boardOwnershipLayer.innerHTML = '';
    if (!Array.isArray(tiles) || !tiles.length) return;

    const playerById = new Map((players || []).map(player => [player.id, player]));

    tiles.forEach(tile => {
      if (!tile.ownerId || (tile.type !== 'property' && tile.type !== 'utility' && tile.type !== 'railroad')) {
        return;
      }

      const owner = playerById.get(tile.ownerId);
      if (!owner) return;

      const position = BOARD_POSITIONS[tile.index % BOARD_POSITIONS.length] || { left: 50, top: 50 };
      const marker = document.createElement('div');
      const edge = Math.floor(tile.index / 10);
      const offsetMap = [
        { left: 0, top: -4 },
        { left: 4, top: 0 },
        { left: 0, top: 4 },
        { left: -4, top: 0 }
      ];
      const offset = offsetMap[edge] || { left: 0, top: 0 };
      marker.className = 'ownership-marker';
      marker.title = `${owner.nickname} owns ${tile.name}`;
      marker.textContent = owner.nickname.charAt(0).toUpperCase();
      marker.style.left = `${position.left + offset.left}%`;
      marker.style.top = `${position.top + offset.top}%`;
      marker.style.background = getPlayerColor(owner);
      elements.boardOwnershipLayer.appendChild(marker);
    });
  }

  function renderMyProperties(tiles, players) {
    if (!elements.myPropertiesList) return;

    const localPlayer = players?.find(player => player.clientId === localState.clientId);
    const ownedTiles = (tiles || [])
      .filter(tile => localPlayer && localPlayer.properties?.includes(tile.index))
      .sort((a, b) => a.index - b.index);

    elements.myPropertiesList.innerHTML = '';
    if (!ownedTiles.length) {
      elements.myPropertiesList.innerHTML = '<p class="muted" style="padding: 10px;">You do not own any properties yet.</p>';
      return;
    }

    const settings = localState.room?.settings || {};
    const game = localState.game;

    ownedTiles.forEach(tile => {
      const fullSet = tile.group
        ? (tiles || []).filter(entry => entry.group === tile.group && entry.type === 'property' && entry.ownerId === localPlayer.id).length
          === (tiles || []).filter(entry => entry.group === tile.group && entry.type === 'property').length
        : false;
      const currentRent = formatRentPreview(getRentPreview(tile, tile.houseCount || 0, fullSet, game, settings));
      const buildingLabel = tile.type === 'property' ? `H${tile.houseCount || 0}` : '';
      const item = document.createElement('div');
      item.className = 'property-row property-row-clickable';
      item.tabIndex = 0;
      item.dataset.tileIndex = String(tile.index);
      item.innerHTML = `
        <span>
          ${escapeHtml(tile.name)}
          <small class="muted" style="display:block; margin: 4px 0 0;">${escapeHtml(tile.group || tile.type)}${tile.mortgaged ? ' • Mortgaged' : ''}</small>
        </span>
        <span class="property-row-meta"><strong class="property-row-rent">${currentRent}</strong>${buildingLabel ? `<span class="property-row-houses muted">${buildingLabel}</span>` : ''}</span>
      `;
      item.addEventListener('click', () => openPropertyModal(tile.index));
      item.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          openPropertyModal(tile.index);
        }
      });
      elements.myPropertiesList.appendChild(item);
    });
  }

  function renderTradePanel(players, tiles) {
    if (!elements.tradePlayerList) return;
    const localPlayer = players?.find(player => player.clientId === localState.clientId);
    const eligiblePlayers = (players || []).filter(player => (
      player.id !== localPlayer?.id && !player.bankrupt && !player.disconnected
    ));

    elements.tradePlayerList.innerHTML = '';
    if (!eligiblePlayers.length) {
      elements.tradePlayerList.innerHTML = '<p class="muted" style="padding: 10px;">No trade partners are available yet.</p>';
      return;
    }

    const ownedCounts = new Map();
    (tiles || []).forEach(tile => {
      if (!tile.ownerId) return;
      ownedCounts.set(tile.ownerId, (ownedCounts.get(tile.ownerId) || 0) + 1);
    });

    eligiblePlayers.forEach(player => {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'trade-player-card';
      card.dataset.playerId = player.id;
      card.innerHTML = `
        <div class="player-avatar" style="background:${getPlayerColor(player)}"></div>
        <div class="trade-player-copy">
          <strong>${escapeHtml(player.nickname)}</strong>
          <span>${formatMoney(player.cash)} • ${ownedCounts.get(player.id) || 0} properties</span>
        </div>
      `;
      card.addEventListener('click', () => openTradeModal(player.id));
      elements.tradePlayerList.appendChild(card);
    });
  }

  function canMortgageOnTileClient(player, tile, game) {
    if (!player || !tile || tile.ownerId !== player.id) return false;
    if (tile.mortgaged) return false;
    if ((tile.houseCount || 0) > 0) return false;
    if (!['property', 'utility', 'railroad'].includes(tile.type)) return false;
    if (tile.type === 'property') {
      const groupTiles = (game?.tiles || []).filter(entry => entry.group === tile.group && entry.type === 'property' && entry.ownerId === player.id);
      if (groupTiles.some(entry => (entry.houseCount || 0) > 0)) return false;
    }
    return true;
  }

  function getPropertyActionNote(player, tile, game, settings) {
    if (!player || !tile) return "";
    if (game?.pendingPayment?.playerId === player.id) {
      return "Settle your debt: sell buildings or mortgage properties to raise cash.";
    }
    if (tile.type === "railroad") {
      if (tile.mortgaged) return "This airport is mortgaged.";
      return "Airports cannot be developed. Rent increases as you own more airports: 1 = $25, 2 = $50, 3 = $100, 4 = $200.";
    }
    if (tile.type === "utility") {
      if (tile.mortgaged) return "This utility is mortgaged.";
      return "Utilities cannot be developed. Rent is 4x the dice total with one utility and 10x with both.";
    }
    const groupTiles = (game?.tiles || []).filter(entry => entry.group === tile.group && entry.type === "property");
    const ownedInGroup = groupTiles.filter(entry => entry.ownerId === player.id);
    if (ownedInGroup.length !== groupTiles.length) {
      return "You need the full color set before building.";
    }
    if (ownedInGroup.some(entry => entry.mortgaged)) {
      return "You cannot build while any property in this set is mortgaged.";
    }
    if (settings?.evenBuild) {
      const levels = ownedInGroup.map(entry => entry.houseCount || 0);
      const minLevel = Math.min(...levels);
      const maxLevel = Math.max(...levels);
      if ((tile.houseCount || 0) > minLevel) {
        return "Even build: add houses to the least-developed properties in this set first.";
      }
      if ((tile.houseCount || 0) < maxLevel) {
        return "Even build: sell houses from the most-developed properties in this set first.";
      }
    }
    if ((tile.houseCount || 0) >= 5) {
      return "This property already has a hotel.";
    }
    const houseCost = tile.houseCost || getPropertyHouseCost(tile);
    if (player.cash < houseCost) {
      return `You need ${formatMoney(houseCost)} to build here.`;
    }
    return "Build evenly across the color group, one step at a time.";
  }

  function renderPropertyModal(game, players) {
    if (!elements.propertyModal || !propertyUiState) return;
    const tile = game?.tiles?.find(entry => entry.index === propertyUiState.tileIndex);
    const localPlayer = players?.find(player => player.clientId === localState.clientId);
    if (!tile || !localPlayer || tile.ownerId !== localPlayer.id) {
      closePropertyModal();
      return;
    }

    const settings = localState.room?.settings || {};
    const ownsTile = tile.ownerId === localPlayer.id;
    const settlingDebt = game?.pendingPayment?.playerId === localPlayer.id;
    const isRailroad = tile.type === "railroad";
    const isUtility = tile.type === "utility";
    const isSpecialTile = isRailroad || isUtility;
    const specialMax = isRailroad ? 4 : isUtility ? 2 : 0;
    const specialOwnedCount = isRailroad
      ? (game?.tiles || []).filter(entry => entry.type === "railroad" && entry.ownerId === localPlayer.id).length
      : isUtility
        ? (game?.tiles || []).filter(entry => entry.type === "utility" && entry.ownerId === localPlayer.id).length
        : 0;
    const fullSet = tile.group ? game?.tiles?.filter(entry => entry.group === tile.group && entry.type === "property" && entry.ownerId === localPlayer.id).length === game?.tiles?.filter(entry => entry.group === tile.group && entry.type === "property").length : false;
    const houseCost = tile.houseCost || getPropertyHouseCost(tile);
    const currentLevel = tile.houseCount || 0;
    const previewLevels = isRailroad ? [1, 2, 3, 4] : isUtility ? [1, 2] : [0, 1, 2, 3, 4, 5];

    if (elements.propertyModalName) elements.propertyModalName.textContent = tile.name;
    if (elements.propertyModalGroup) {
      const status = isUtility
        ? "Utility"
        : isRailroad
          ? "Airport"
          : tile.group || tile.type;
      elements.propertyModalGroup.textContent = `${status} • ${formatMoney(tile.price || 0)}`;
    }
    if (elements.propertyModalStatus) {
      elements.propertyModalStatus.textContent = tile.mortgaged
        ? "Mortgaged"
        : isRailroad
          ? `${specialOwnedCount} of 4 airports owned`
          : isUtility
            ? `${specialOwnedCount} of 2 utilities owned`
            : currentLevel >= 5
              ? "Hotel built"
              : currentLevel > 0
                ? `${currentLevel} house${currentLevel === 1 ? "" : "s"}`
                : "No buildings yet";
    }
    if (elements.propertyModalCurrentRent) {
      const currentRent = getRentPreview(tile, isSpecialTile ? specialOwnedCount : currentLevel, fullSet, game, settings);
      elements.propertyModalCurrentRent.innerHTML = `Current rent: <strong>${formatRentPreview(currentRent)}</strong>`;
    }
    if (elements.propertyModalNote) {
      elements.propertyModalNote.textContent = getPropertyActionNote(localPlayer, tile, game, settings);
    }

    if (elements.propertyModalRents) {
      elements.propertyModalRents.innerHTML = "";
      previewLevels.forEach(level => {
        const rentValue = getRentPreview(tile, level, fullSet, game, settings);
        const isCurrent = isSpecialTile ? level === specialOwnedCount : level === currentLevel;
        const row = document.createElement("div");
        row.className = `rent-row${isCurrent ? " current" : ""}`;
        row.innerHTML = `
          <span>${isRailroad || isUtility ? `${level} owned` : level === 0 ? "Base" : level === 5 ? "Hotel" : `${level} house${level === 1 ? "" : "s"}`}</span>
          <strong>${formatRentPreview(rentValue)}</strong>
        `;
        elements.propertyModalRents.appendChild(row);
      });
    }

    if (elements.propertyModalHouses) {
      if (elements.propertyModalHouses.previousElementSibling) {
        elements.propertyModalHouses.previousElementSibling.textContent = isSpecialTile ? "Ownership" : "Buildings";
      }
      if (isSpecialTile) {
        elements.propertyModalHouses.innerHTML = `<div class="property-ownership-summary"><strong>${specialOwnedCount}</strong><span>of ${specialMax} owned</span></div>`;
      } else {
        elements.propertyModalHouses.innerHTML = Array.from({ length: 5 }, (_, index) => {
          const filled = index < Math.min(currentLevel, 5);
          return `<span class="house-pip ${filled ? "filled" : ""}">${currentLevel >= 5 && index === 4 ? "H" : ""}</span>`;
        }).join("");
      }
    }

    if (elements.propertyBuildBtn) {
      const canBuild = !isSpecialTile && !settlingDebt && canBuildOnTileClient(localPlayer, tile, game, settings);
      elements.propertyBuildBtn.classList.toggle("hidden", isSpecialTile);
      if (!isSpecialTile) {
        elements.propertyBuildBtn.disabled = !canBuild;
        elements.propertyBuildBtn.textContent = currentLevel >= 4 ? "Build hotel" : "Build house";
      }
    }
    if (elements.propertySellBtn) {
      const canSell = !isSpecialTile && canSellFromTileClient(localPlayer, tile, game, settings);
      elements.propertySellBtn.classList.toggle("hidden", isSpecialTile);
      if (!isSpecialTile) {
        elements.propertySellBtn.disabled = !canSell;
        elements.propertySellBtn.textContent = currentLevel >= 5 ? "Sell hotel" : "Sell house";
      }
    }
    if (elements.propertyMortgageBtn) {
      const canMortgage = ownsTile && canMortgageOnTileClient(localPlayer, tile, game);
      const canUnmortgage = ownsTile && tile.mortgaged && !settlingDebt;
      elements.propertyMortgageBtn.disabled = !canMortgage && !canUnmortgage;
      elements.propertyMortgageBtn.textContent = tile.mortgaged ? `Unmortgage ${formatMoney(Math.ceil((tile.price || 0) / 2 * 1.1))}` : `Mortgage ${formatMoney(Math.floor((tile.price || 0) / 2))}`;
    }
  }

  function openPropertyModal(tileIndex) {
    propertyUiState = { tileIndex };
    showModal(elements.propertyModal);
    renderPropertyModal(localState.game, localState.room?.players);
  }

  function closePropertyModal() {
    propertyUiState = null;
    hideModal(elements.propertyModal);
  }

  function getTradeablePropertyIndexes(player, tiles) {
    if (!player || !Array.isArray(tiles)) return [];
    return tiles
      .filter(tile => tile.ownerId === player.id && isTradeableTile(tile))
      .map(tile => tile.index);
  }

  function updateTradeModalTotals() {
    if (elements.tradeOfferCashTotal) {
      elements.tradeOfferCashTotal.textContent = formatMoney(tradeUiState.offerCash);
    }
    if (elements.tradeRequestCashTotal) {
      elements.tradeRequestCashTotal.textContent = formatMoney(tradeUiState.requestCash);
    }
    updateTradeSendButtonState();
  }

  function hasTradeSelection() {
    return Boolean(
      tradeUiState.selectedOfferPropertyIndexes.size ||
      tradeUiState.selectedRequestPropertyIndexes.size ||
      tradeUiState.offerCash > 0 ||
      tradeUiState.requestCash > 0
    );
  }

  function updateTradeSendButtonState() {
    if (!elements.tradeSendBtn) return;
    const hasSelection = hasTradeSelection();
    elements.tradeSendBtn.disabled = !hasSelection;
    elements.tradeSendBtn.title = hasSelection
      ? 'Send this trade offer'
      : 'Choose at least one cash or property item on either side of the trade.';
  }

  function renderTradeModal(game, players) {
    if (!elements.tradeModal || !tradeUiState.targetPlayerId) return;
    const localPlayer = players?.find(player => player.clientId === localState.clientId);
    const targetPlayer = players?.find(player => player.id === tradeUiState.targetPlayerId);
    if (!localPlayer || !targetPlayer) {
      closeTradeModal();
      return;
    }

    if (elements.tradeTargetTitle) {
      elements.tradeTargetTitle.textContent = targetPlayer.nickname;
    }
    if (elements.tradeOfferCash) {
      elements.tradeOfferCash.value = String(tradeUiState.offerCash);
    }
    if (elements.tradeRequestCash) {
      elements.tradeRequestCash.value = String(tradeUiState.requestCash);
    }
    updateTradeModalTotals();

    const localTiles = game?.tiles?.filter(tile => tile.ownerId === localPlayer.id) || [];
    const targetTiles = game?.tiles?.filter(tile => tile.ownerId === targetPlayer.id) || [];
    const localTradeable = localTiles.filter(isTradeableTile);
    const targetTradeable = targetTiles.filter(isTradeableTile);

    if (elements.tradeOfferProperties) {
      elements.tradeOfferProperties.innerHTML = '';
      if (!localTradeable.length) {
        elements.tradeOfferProperties.innerHTML = '<p class="muted">No tradeable properties.</p>';
      } else {
        localTradeable.forEach(tile => {
          const chip = document.createElement('button');
          chip.type = 'button';
          chip.className = `trade-property-chip ${tradeUiState.selectedOfferPropertyIndexes.has(tile.index) ? 'selected' : ''}`;
          chip.setAttribute('aria-pressed', tradeUiState.selectedOfferPropertyIndexes.has(tile.index) ? 'true' : 'false');
          chip.innerHTML = `
            <span>${escapeHtml(tile.name)}</span>
            <small>${formatMoney(tile.price || 0)}</small>
          `;
          chip.addEventListener('click', () => {
            if (tradeUiState.selectedOfferPropertyIndexes.has(tile.index)) {
              tradeUiState.selectedOfferPropertyIndexes.delete(tile.index);
            } else {
              tradeUiState.selectedOfferPropertyIndexes.add(tile.index);
            }
            renderTradeModal(game, players);
          });
          elements.tradeOfferProperties.appendChild(chip);
        });
      }
    }

    if (elements.tradeRequestProperties) {
      elements.tradeRequestProperties.innerHTML = '';
      if (!targetTradeable.length) {
        elements.tradeRequestProperties.innerHTML = '<p class="muted">No tradeable properties.</p>';
      } else {
        targetTradeable.forEach(tile => {
          const chip = document.createElement('button');
          chip.type = 'button';
          chip.className = `trade-property-chip ${tradeUiState.selectedRequestPropertyIndexes.has(tile.index) ? 'selected' : ''}`;
          chip.setAttribute('aria-pressed', tradeUiState.selectedRequestPropertyIndexes.has(tile.index) ? 'true' : 'false');
          chip.innerHTML = `
            <span>${escapeHtml(tile.name)}</span>
            <small>${formatMoney(tile.price || 0)}</small>
          `;
          chip.addEventListener('click', () => {
            if (tradeUiState.selectedRequestPropertyIndexes.has(tile.index)) {
              tradeUiState.selectedRequestPropertyIndexes.delete(tile.index);
            } else {
              tradeUiState.selectedRequestPropertyIndexes.add(tile.index);
            }
            renderTradeModal(game, players);
          });
          elements.tradeRequestProperties.appendChild(chip);
        });
      }
    }

    updateTradeSendButtonState();
  }

  function openTradeModal(targetPlayerId) {
    tradeUiState = {
      targetPlayerId,
      selectedOfferPropertyIndexes: new Set(),
      selectedRequestPropertyIndexes: new Set(),
      offerCash: 0,
      requestCash: 0
    };
    showModal(elements.tradeModal);
    renderTradeModal(localState.game, localState.room?.players);
  }

  function closeTradeModal() {
    tradeUiState = {
      targetPlayerId: null,
      selectedOfferPropertyIndexes: new Set(),
      selectedRequestPropertyIndexes: new Set(),
      offerCash: 0,
      requestCash: 0
    };
    hideModal(elements.tradeModal);
  }

  function openIncomingTradeModal(trade) {
    if (!trade) return;
    gameState.pendingTrade = trade;
    const players = localState.room?.players || [];
    const fromPlayer = players.find(player => player.id === trade.fromPlayerId);
    const toPlayer = players.find(player => player.id === trade.toPlayerId);
    if (elements.incomingTradeSummary) {
      elements.incomingTradeSummary.textContent = `${fromPlayer?.nickname || 'A player'} wants to trade with ${toPlayer?.nickname || 'you'}`;
    }
    if (elements.incomingTradeDetails) {
      const gameTiles = localState.game?.tiles || [];
      const giveNames = trade.givePropertyIndexes.map(index => gameTiles.find(tile => tile.index === index)?.name || `#${index}`);
      const requestNames = trade.requestPropertyIndexes.map(index => gameTiles.find(tile => tile.index === index)?.name || `#${index}`);
      elements.incomingTradeDetails.innerHTML = `
        <div class="incoming-trade-row"><span>They offer</span><strong>${formatMoney(trade.giveCash)} cash${giveNames.length ? ` and ${giveNames.join(', ')}` : ''}</strong></div>
        <div class="incoming-trade-row"><span>They request</span><strong>${formatMoney(trade.requestCash)} cash${requestNames.length ? ` and ${requestNames.join(', ')}` : ''}</strong></div>
      `;
    }
    showModal(elements.incomingTradeModal);
  }

  function closeIncomingTradeModal() {
    gameState.pendingTrade = null;
    hideModal(elements.incomingTradeModal);
  }

  function declineIncomingTrade() {
    if (!gameState.pendingTrade) {
      closeIncomingTradeModal();
      return;
    }
    const tradeId = gameState.pendingTrade.id;
    emit('respond-trade', { tradeId, accept: false }, response => {
      if (!response?.success) {
        showToast(response?.error || 'Could not decline trade.', 'error');
        return;
      }
      showToast('Trade declined.', 'warning');
      closeIncomingTradeModal();
    });
  }

  function declinePurchaseViaEscape() {
    if (!currentPurchase) {
      closePurchaseModal();
      return;
    }
    emit('decline-property', { tileIndex: currentPurchase.tileIndex }, response => {
      if (!response?.success) {
        showToast(response?.error || 'Could not decline property.', 'error');
        return;
      }
      closePurchaseModal();
    });
  }

  function setTokens(players) {
    const tokenLayer = document.getElementById('token-layer');
    if (!tokenLayer) return;

    tokenLayer.innerHTML = '';
    const positions = new Map();

    players.forEach(player => {
      const key = player.position % BOARD_POSITIONS.length;
      const list = positions.get(key) || [];
      list.push(player);
      positions.set(key, list);
    });

    positions.forEach((playersOnTile, tileIndex) => {
      const position = BOARD_POSITIONS[tileIndex] || { left: 50, top: 50 };
      const offsets = getTokenOffsets(playersOnTile.length);
      playersOnTile.forEach((player, index) => {
        const offset = offsets[index % offsets.length];
        const token = document.createElement('div');
        token.className = 'player-token';
        token.dataset.clientId = player.clientId || '';
        token.textContent = player.nickname.charAt(0).toUpperCase();
        token.style.left = `${position.left}%`;
        token.style.top = `${position.top}%`;
        token.style.transform = `translate(calc(-50% + ${offset.x}px), calc(-50% + ${offset.y}px))`;
        token.style.background = getPlayerColor(player);
        tokenLayer.appendChild(token);
      });
    });
  }

  function getTokenOffsets(total) {
    if (total <= 1) return [{ x: 0, y: 0 }];

    const spacing = Math.max(10, Math.min(18, Math.floor(TOKEN_SIZE / 2) + 2));
    const compact = Math.max(8, Math.floor(spacing * 0.75));

    if (total === 2) {
      return [
        { x: -spacing, y: 0 },
        { x: spacing, y: 0 }
      ];
    }

    if (total === 3) {
      return [
        { x: -spacing, y: -compact },
        { x: spacing, y: -compact },
        { x: 0, y: spacing }
      ];
    }

    if (total === 4) {
      return [
        { x: -spacing, y: -spacing },
        { x: spacing, y: -spacing },
        { x: -spacing, y: spacing },
        { x: spacing, y: spacing }
      ];
    }

    return [
      { x: -spacing, y: -spacing },
      { x: spacing, y: -spacing },
      { x: -spacing, y: spacing },
      { x: spacing, y: spacing },
      { x: 0, y: -spacing * 1.6 },
      { x: 0, y: spacing * 1.6 },
      { x: -spacing * 1.6, y: 0 },
      { x: spacing * 1.6, y: 0 }
    ];
  }

  function renderSettings(settings, isHost) {
    if (!settings) return;

    document.querySelectorAll('.setting-toggle input, .custom-select[data-setting]').forEach(input => {
      const key = input.dataset.setting;
      if (!key) return;
      if (input.type === 'checkbox') {
        input.checked = Boolean(settings[key]);
      } else if (input.tagName === 'SELECT') {
        input.value = String(settings[key]);
      }
      input.disabled = !isHost;
    });
  }

  function renderAuction(auction, game) {
    if (!elements.auctionModal) return;

    if (!auction?.active) {
      auctionUiState = null;
      auctionUiGame = null;
      auctionUiPressLockUntil = 0;
      stopAuctionTicker();
      hideModal(elements.auctionModal);
      return;
    }

    auctionUiState = auction;
    auctionUiGame = game;
    elements.auctionPropertyName.textContent = auction.tileName || 'Property';
    showModal(elements.auctionModal);
    startAuctionTicker();
  }

  function renderGameState(state) {
    if (!state) return;

    gameState.started = state.game.started;
    gameState.currentPlayerId = state.game.currentPlayerId;
    gameState.lastDice = state.game.lastDice || [0, 0];
    gameState.hasRolled = Boolean(state.game.hasRolled);
    gameState.auctionActive = Boolean(state.game.auction?.active);
    gameState.awaitingDecision = Boolean(currentPurchase || state.game.pendingPurchaseOffer);
    gameState.extraRollPending = Boolean(state.game.extraRollPending);
    gameState.pendingTrade = state.game.pendingTrade || null;
    localRollPending = false;

    renderGameFeed(state.game.feed);
    renderActiveRules(state.room.settings);
    maybeShowWinnerModal(state.game, state.room);

    const localPlayer = state.room.players.find(player => player.clientId === localState.clientId);
    const pendingPurchase = state.game.pendingPurchaseOffer;
    if (
      pendingPurchase &&
      localPlayer &&
      pendingPurchase.playerId === localPlayer.id &&
      state.game.currentPlayerId === localPlayer.id
    ) {
      const purchaseTile = state.game.tiles.find(tile => tile.index === pendingPurchase.tileIndex);
      if (purchaseTile && (!currentPurchase || currentPurchase.tileIndex !== purchaseTile.index)) {
        openPurchaseModal({
          tileIndex: purchaseTile.index,
          name: purchaseTile.name,
          price: purchaseTile.price
        });
      }
    } else if (!pendingPurchase && currentPurchase) {
      closePurchaseModal();
    }

    setPlayerList(state.room.players, state.game.currentPlayerId, state.game.turnOrder);
    setTurnBanner(state.game, state.game.vacationPool || 0);
    setTokens(state.game.players);
    renderBoardOwnership(state.game.tiles, state.game.players);
    renderMyProperties(state.game.tiles, state.game.players);
    renderTradePanel(state.room.players, state.game.tiles);
    renderPropertyModal(state.game, state.room.players);
    renderAuction(state.game.auction, state.game);
    if (state.game.pendingTrade) {
      const localPlayer = state.room.players.find(player => player.clientId === localState.clientId);
      if (localPlayer && state.game.pendingTrade.toPlayerId === localPlayer.id) {
        openIncomingTradeModal(state.game.pendingTrade);
      }
    } else {
      closeIncomingTradeModal();
    }

    if (elements.settingsWindow) {
      elements.settingsWindow.classList.toggle('hidden', state.room.started);
    }
    if (elements.propertiesWindow) {
      elements.propertiesWindow.classList.toggle('hidden', !state.room.started);
    }
    if (elements.tradeWindow) {
      elements.tradeWindow.classList.toggle('hidden', !state.room.started);
    }

    if (state.room.started) {
      elements.startGameOverlay?.classList.add('hidden');
      hideModal(elements.winnerModal);
    } else if (localState.isHost) {
      elements.startGameOverlay?.classList.remove('hidden');
    } else {
      elements.startGameOverlay?.classList.add('hidden');
    }

    if (elements.centerStartBtn) {
      const activePlayers = (state.room.players || []).filter(player => !player.bankrupt && !player.disconnected).length;
      const canStart = localState.isHost && !state.room.started && activePlayers >= 2;
      elements.centerStartBtn.disabled = !canStart;
      elements.centerStartBtn.title = canStart ? 'Start the game' : 'Need at least 2 players to start';
    }

    syncPanelHeights();
  }

  function renderRoomState(state) {
    if (!state?.room || !state?.game) return;

    if (state.serverTime) {
      serverTimeOffset = state.serverTime - Date.now();
    }

    localState.room = state.room;
    localState.game = state.game;

    if (elements.mainWorkspace.classList.contains('hidden')) {
      showWorkspace();
    }

    if (!localState.clientId) {
      localState.clientId = getClientId();
    }

    const currentPlayer = state.room.players.find(player => player.clientId === localState.clientId);
    localState.isHost = Boolean(
      currentPlayer?.isHost ||
      (currentPlayer && state.room.hostId && currentPlayer.id === state.room.hostId)
    );

    setRoomCode(state.room.roomCode);
    renderSettings(state.room.settings, localState.isHost);
    renderGameState(state);

    // Update which colors are available, but do NOT call syncAppearanceSelection here
    // to avoid a feedback loop (render → sync → server broadcast → render → sync …).
    // The server-synced color will be sent when the user explicitly picks a color or
    // clicks Continue on the setup overlay.
    const takenByOthers = new Set();
    state.room.players.forEach(p => {
      if (p.clientId !== localState.clientId && p.color) {
        takenByOthers.add(p.color);
      }
    });

    if (takenByOthers.has(selectedColor)) {
      const freeColor = PLAYER_COLORS.find(c => !takenByOthers.has(c));
      if (freeColor) {
        selectedColor = freeColor;
      }
    }
    renderColors();
  }

  function syncPanelHeights() {
    const height = elements.boardImage.getBoundingClientRect().height;
    if (!height || height < 100) {
      setTimeout(syncPanelHeights, 50);
      return;
    }

    const chatPanel = document.querySelector('.chat-panel');
    if (chatPanel) chatPanel.style.height = `${height}px`;
    if (elements.rightSidebar) elements.rightSidebar.style.height = `${height}px`;
  }

  function openPurchaseModal(data) {
    currentPurchase = data;
    gameState.awaitingDecision = true;
    if (!elements.purchaseModal) return;
    elements.purchaseName.textContent = data.name;
    elements.purchaseCost.textContent = formatMoney(data.price);
    const localPlayer = localState.game?.players?.find(player => player.clientId === localState.clientId);
    const myCash = localPlayer?.cash || 0;
    if (elements.purchaseMyCash) {
      elements.purchaseMyCash.textContent = formatMoney(myCash);
      elements.purchaseMyCash.classList.toggle('insufficient', myCash < data.price);
    }
    const auctionEnabled = Boolean(localState.room?.settings?.auction);
    if (elements.purchaseModalNote) {
      if (myCash < data.price) {
        elements.purchaseModalNote.textContent = auctionEnabled
          ? 'You cannot afford this property. Declining will start an auction.'
          : 'You cannot afford this property.';
      } else {
        elements.purchaseModalNote.textContent = auctionEnabled
          ? 'Would you like to buy this property now or let it go to auction?'
          : 'Would you like to buy this property now?';
      }
    }
    if (elements.purchaseConfirmBtn) {
      elements.purchaseConfirmBtn.disabled = myCash < data.price;
    }
    showModal(elements.purchaseModal);
    elements.purchaseConfirmBtn?.focus();
    updateTurnButtons();
  }

  function closePurchaseModal() {
    currentPurchase = null;
    gameState.awaitingDecision = false;
    hideModal(elements.purchaseModal);
    updateTurnButtons();
  }

  function joinRoom() {
    const nickname = elements.nicknameInput.value.trim();
    const roomCode = elements.roomCodeInput.value.trim().toUpperCase();

    if (!nickname) {
      elements.nicknameInput.focus();
      return;
    }
    if (!roomCode) {
      showToast('Please enter a room code to join.', 'error');
      return;
    }

    setLandingBusy(true);
    emit('join-room', { nickname, color: selectedColor, roomCode }, response => {
      setLandingBusy(false);
      if (!response?.success) {
        showToast(response?.error || 'Unable to join room.', 'error');
        return;
      }
      showLobbyScreen();
      setRoomCode(response.roomCode);
    });
  }

  function createRoom() {
    const nickname = elements.nicknameInput.value.trim() || 'Host';
    setLandingBusy(true);
    emit('create-room', { nickname, color: selectedColor }, response => {
      setLandingBusy(false);
      if (!response?.success) {
        showToast(response?.error || 'Unable to create room.', 'error');
        return;
      }
      showLobbyScreen();
      setRoomCode(response.roomCode);
    });
  }

  function showLobbyScreen() {
    showWorkspace();
    showOverlay();
    appendChat('You entered the room.', 'System');
  }

  function renderColors() {
    const takenByOthers = new Set();
    if (localState.room && localState.room.players) {
      localState.room.players.forEach(p => {
        if (p.clientId !== localState.clientId && p.color) {
          takenByOthers.add(p.color);
        }
      });
    }

    elements.colorGrids.forEach(grid => {
      grid.querySelectorAll('button').forEach(button => {
        const color = button.dataset.color;
        const isTaken = takenByOthers.has(color);
        button.disabled = isTaken;
        if (isTaken) {
          button.style.opacity = '0.3';
          button.style.cursor = 'not-allowed';
        } else {
          button.style.opacity = '1';
          button.style.cursor = 'pointer';
        }
        button.classList.toggle('active', color === selectedColor);
      });
    });
  }

  function placeAuctionBid(step) {
    if (!auctionUiState) return;
    const amount = (auctionUiState.highestBid || 0) + step;
    auctionUiPressLockUntil = getServerNow() + AUCTION_PRESS_DELAY_MS;
    refreshAuctionUi();

    emit('auction-bid', { amount }, response => {
      if (!response?.success) {
        appendChat(response?.error || 'Could not place bid.', 'System');
      }
      window.setTimeout(refreshAuctionUi, AUCTION_PRESS_DELAY_MS);
    });
  }

  function startGame() {
    if (!localState.isHost) return;
    emit('start-game', {}, response => {
      if (!response?.success) {
        appendChat(response?.error || 'Could not start game.', 'System');
      }
    });
  }

  function handleConnect() {
    localState.clientId = getClientId();
    emit('restore-session', {}, () => {});
    if (hadConnectionLoss) {
      showToast('Reconnected to the server.', 'success');
      hadConnectionLoss = false;
    }
  }

  if (socket.connected) {
    handleConnect();
  }
  socket.on('connect', handleConnect);

  socket.on('disconnect', () => {
    hadConnectionLoss = true;
    showToast('Connection lost. Reconnecting…', 'warning');
  });

  socket.on('connect_error', () => {
    showToast('Unable to reach the server. Retrying…', 'error');
  });

  socket.on('update-state', renderRoomState);

  socket.on('chat-message', ({ nickname, text }) => {
    appendChat(text, nickname);
  });

  socket.on('system-message', ({ text }) => {
    appendChat(text, 'System');
    const important = /wins the game|bankrupt|Auction|disconnected|reconnected|started|trade/i.test(text);
    if (important) {
      showToast(text, 'info');
    }
  });

  socket.on('purchase-offer', openPurchaseModal);
  socket.on('trade-offer', ({ trade }) => {
    openIncomingTradeModal(trade);
  });

  on(elements.landingForm, 'submit', event => {
    event.preventDefault();
    joinRoom();
  });

  if (elements.createBtn) {
    on(elements.createBtn, 'click', createRoom);
  }

  on(elements.chatInput, 'keydown', event => {
    if (event.key !== 'Enter') return;
    const text = elements.chatInput.value.trim();
    if (!text) return;
    // Don't echo locally — the server will broadcast chat-message back to everyone
    emit('send-chat', { text }, () => {});
    elements.chatInput.value = '';
  });

  if (elements.overlayContinueBtn) {
    on(elements.overlayContinueBtn, 'click', () => {
      const nickname = elements.nicknameInput.value.trim();
      syncAppearanceSelection(selectedColor, nickname).then(success => {
        if (success) {
          hideOverlay();
          elements.chatInput.focus();
        } else {
          showToast('Could not save your appearance. Please try again.', 'error');
        }
      });
    });
  }

  elements.colorGrids.forEach(grid => {
    grid.innerHTML = '';
    PLAYER_COLORS.forEach(color => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'color-circle';
      button.style.background = color;
      button.dataset.color = color;
      button.setAttribute('aria-label', `Select ${COLOR_NAMES[color] || 'player'} color`);
      on(button, 'click', () => {
        selectedColor = color;
        renderColors();
        applyLocalColorPreview(color);
        if (localState.room && localState.game) {
          renderGameState({ room: localState.room, game: localState.game });
        }
        syncAppearanceSelection(color, elements.nicknameInput.value.trim());
      });
      if (selectedColor === color) button.classList.add('active');
      grid.appendChild(button);
    });
  });

  renderColors();

  if (elements.copyRoomBtn) {
    on(elements.copyRoomBtn, 'click', async () => {
      const text = elements.roomCodeValue?.textContent;
      if (!text || text === '----') {
        showToast('No room code to copy.', 'error');
        return;
      }
      try {
        if (navigator.clipboard) {
          await navigator.clipboard.writeText(text);
          showToast('Room code copied.', 'success');
        } else {
          showToast(`Room code: ${text}`, 'info');
        }
      } catch (error) {
        showToast('Could not copy room code.', 'error');
      }
    });
  }

  if (elements.centerStartBtn) on(elements.centerStartBtn, 'click', startGame);

  if (elements.helpBtn && elements.helpModal) {
    on(elements.helpBtn, 'click', () => {
      showModal(elements.helpModal);
    });
  }

  if (elements.helpCloseBtn && elements.helpModal) {
    on(elements.helpCloseBtn, 'click', () => {
      hideModal(elements.helpModal);
    });
  }

  if (elements.helpModal) {
    on(elements.helpModal, 'click', event => {
      if (event.target === elements.helpModal) {
        hideModal(elements.helpModal);
      }
    });
  }

  if (elements.propertyModal) {
    on(elements.propertyModal, 'click', event => {
      if (event.target === elements.propertyModal) {
        closePropertyModal();
      }
    });
  }

  if (elements.tradeModal) {
    on(elements.tradeModal, 'click', event => {
      if (event.target === elements.tradeModal) {
        closeTradeModal();
      }
    });
  }

  if (elements.incomingTradeModal) {
    // Backdrop clicks intentionally do nothing — use Decline to avoid misclicks.
  }

  if (elements.winnerCloseBtn && elements.winnerModal) {
    on(elements.winnerCloseBtn, 'click', () => {
      hideModal(elements.winnerModal);
    });
  }

  if (elements.payJailBtn) {
    on(elements.payJailBtn, 'click', () => {
      emit('pay-jail-fine', {}, response => {
        if (!response?.success) {
          showToast(response?.error || 'Could not pay jail fine.', 'error');
        } else {
          showToast('You paid the jail fine.', 'success');
        }
      });
    });
  }

  if (elements.declareBankruptcyBtn) {
    on(elements.declareBankruptcyBtn, 'click', () => {
      if (!window.confirm('Declare bankruptcy? You will be removed from the game and your assets will be transferred to your creditor.')) {
        return;
      }
      emit('declare-bankruptcy', {}, response => {
        if (!response?.success) {
          showToast(response?.error || 'Could not declare bankruptcy.', 'error');
        } else {
          showToast('You declared bankruptcy.', 'warning');
        }
      });
    });
  }

  if (elements.auctionBid2Btn) {
    on(elements.auctionBid2Btn, 'click', () => placeAuctionBid(2));
  }
  if (elements.auctionBid10Btn) {
    on(elements.auctionBid10Btn, 'click', () => placeAuctionBid(10));
  }
  if (elements.auctionBid100Btn) {
    on(elements.auctionBid100Btn, 'click', () => placeAuctionBid(100));
  }

  if (elements.propertyBuildBtn) {
    on(elements.propertyBuildBtn, 'click', () => {
      if (!propertyUiState) return;
      emit('manage-property', { tileIndex: propertyUiState.tileIndex, action: 'build-house' }, response => {
        if (!response?.success) {
          appendChat(response?.error || 'Could not build a house.', 'System');
          showToast(response?.error || 'Could not build a house.', 'error');
        }
      });
    });
  }

  if (elements.propertySellBtn) {
    on(elements.propertySellBtn, 'click', () => {
      if (!propertyUiState) return;
      emit('manage-property', { tileIndex: propertyUiState.tileIndex, action: 'sell-house' }, response => {
        if (!response?.success) {
          appendChat(response?.error || 'Could not sell a house.', 'System');
          showToast(response?.error || 'Could not sell a house.', 'error');
        }
      });
    });
  }

  if (elements.propertyMortgageBtn) {
    on(elements.propertyMortgageBtn, 'click', () => {
      if (!propertyUiState) return;
      const tile = localState.game?.tiles?.find(entry => entry.index === propertyUiState.tileIndex);
      const action = tile?.mortgaged ? 'unmortgage' : 'mortgage';
      emit('manage-property', { tileIndex: propertyUiState.tileIndex, action }, response => {
        if (!response?.success) {
          appendChat(response?.error || 'Could not update mortgage status.', 'System');
          showToast(response?.error || 'Could not update mortgage status.', 'error');
        }
      });
    });
  }

  if (elements.propertyCloseBtn) {
    on(elements.propertyCloseBtn, 'click', closePropertyModal);
  }

  if (elements.tradeOfferCash) {
    on(elements.tradeOfferCash, 'input', () => {
      const value = Number(elements.tradeOfferCash.value);
      tradeUiState.offerCash = Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
      updateTradeModalTotals();
    });
  }

  if (elements.tradeRequestCash) {
    on(elements.tradeRequestCash, 'input', () => {
      const value = Number(elements.tradeRequestCash.value);
      tradeUiState.requestCash = Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
      updateTradeModalTotals();
    });
  }

  if (elements.tradeCloseBtn) {
    on(elements.tradeCloseBtn, 'click', closeTradeModal);
  }

  if (elements.tradeSendBtn) {
    on(elements.tradeSendBtn, 'click', () => {
      if (!tradeUiState.targetPlayerId) return;
      if (!hasTradeSelection()) {
        showToast('Choose at least one cash or property item on either side of the trade.', 'error');
        return;
      }
      emit('propose-trade', {
        toPlayerId: tradeUiState.targetPlayerId,
        giveCash: tradeUiState.offerCash,
        requestCash: tradeUiState.requestCash,
        givePropertyIndexes: [...tradeUiState.selectedOfferPropertyIndexes],
        requestPropertyIndexes: [...tradeUiState.selectedRequestPropertyIndexes]
      }, response => {
        if (!response?.success) {
          appendChat(response?.error || 'Could not send trade.', 'System');
          showToast(response?.error || 'Could not send trade.', 'error');
          return;
        }
        showToast('Trade sent.', 'success');
        closeTradeModal();
      });
    });
  }

  if (elements.incomingTradeAcceptBtn) {
    on(elements.incomingTradeAcceptBtn, 'click', () => {
      if (!gameState.pendingTrade) return;
      emit('respond-trade', { tradeId: gameState.pendingTrade.id, accept: true }, response => {
        if (!response?.success) {
          appendChat(response?.error || 'Could not accept trade.', 'System');
          showToast(response?.error || 'Could not accept trade.', 'error');
        } else {
          showToast('Trade accepted.', 'success');
        }
        closeIncomingTradeModal();
      });
    });
  }

  if (elements.incomingTradeDeclineBtn) {
    on(elements.incomingTradeDeclineBtn, 'click', () => {
      if (!gameState.pendingTrade) return;
      emit('respond-trade', { tradeId: gameState.pendingTrade.id, accept: false }, response => {
        if (!response?.success) {
          appendChat(response?.error || 'Could not decline trade.', 'System');
          showToast(response?.error || 'Could not decline trade.', 'error');
        } else {
          showToast('Trade declined.', 'warning');
        }
        closeIncomingTradeModal();
      });
    });
  }

  on(elements.rollDiceBtn, 'click', () => {
    if (!localState.currentPlayerIsMe || elements.rollDiceBtn.disabled) return;
    localRollPending = true;
    elements.rollDiceBtn.disabled = true;
    emit('roll-dice', {}, response => {
      localRollPending = false;
      if (!response?.success) {
        appendChat(response?.error || 'Unable to roll.', 'System');
        showToast(response?.error || 'Unable to roll.', 'error');
      }
      updateTurnButtons();
    });
  });

  on(elements.endTurnBtn, 'click', () => {
    if (!localState.currentPlayerIsMe || elements.endTurnBtn.disabled) return;
    emit('end-turn', {}, response => {
      if (!response?.success) {
        appendChat(response?.error || 'Could not end turn.', 'System');
      }
    });
  });

  if (elements.purchaseConfirmBtn) {
    on(elements.purchaseConfirmBtn, 'click', () => {
      if (!currentPurchase) return;
      emit('purchase-property', { tileIndex: currentPurchase.tileIndex }, response => {
        if (!response?.success) {
          appendChat(response?.error || 'Could not complete purchase.', 'System');
          showToast(response?.error || 'Could not complete purchase.', 'error');
          return;
        }
        showToast('Property purchased.', 'success');
        closePurchaseModal();
      });
    });
  }

  if (elements.purchaseDeclineBtn) {
    on(elements.purchaseDeclineBtn, 'click', () => {
      if (!currentPurchase) return;
      emit('decline-property', { tileIndex: currentPurchase.tileIndex }, response => {
        if (!response?.success) {
          appendChat(response?.error || 'Could not decline property.', 'System');
          showToast(response?.error || 'Could not decline property.', 'error');
        } else {
          showToast('Property declined.', 'warning');
        }
        closePurchaseModal();
      });
    });
  }

  settingsInputs.forEach(input => {
    on(input, 'change', () => {
      if (!localState.isHost) return;
      const key = input.dataset.setting;
      if (!key) return;
      const value = input.type === 'checkbox' ? input.checked : input.value;
      emit('set-setting', { key, value }, response => {
        if (!response?.success) {
          appendChat(response?.error || 'Unable to update setting.', 'System');
        }
      });
    });
  });


  on(elements.boardImage, 'load', syncPanelHeights);
  if (elements.boardImage.complete) {
    setTimeout(syncPanelHeights, 100);
  }

  on(document, 'keydown', event => {
    if (event.key !== 'Escape') return;
    if (gameState.auctionActive) return;
    if (currentPurchase) {
      declinePurchaseViaEscape();
      return;
    }
    if (gameState.pendingTrade && elements.incomingTradeModal && !elements.incomingTradeModal.classList.contains('hidden')) {
      declineIncomingTrade();
      return;
    }
    hideModal(elements.helpModal);
    closePropertyModal();
    closeTradeModal();
  });

  const onResize = () => {
    clearTimeout(window.syncPanelTimeout);
    window.syncPanelTimeout = setTimeout(syncPanelHeights, 100);
  };
  on(window, 'resize', onResize);

  return () => {
    stopAuctionTicker();
    disposers.forEach(dispose => dispose());
    socket.off('connect');
    socket.off('update-state');
    socket.off('chat-message');
    socket.off('system-message');
    socket.off('purchase-offer');
    socket.off('trade-offer');
    socket.disconnect();
  };
}

document.addEventListener('DOMContentLoaded', () => {
  initGameClient();
});



