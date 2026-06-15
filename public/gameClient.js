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

const PLAYER_COLORS = [
  '#111827', '#ef4444', '#f59e0b', '#84cc16', '#06b6d4', '#6366f1', '#a78bfa', '#fb7185'
];

function initGameClient() {
  const elements = {
    landingScreen: document.getElementById('landing-screen'),
    mainWorkspace: document.getElementById('main-workspace'),
    landingForm: document.getElementById('landing-form'),
    nicknameInput: document.getElementById('nickname-input'),
    roomCodeInput: document.getElementById('room-code-input'),
    createBtn: document.getElementById('create-btn'),
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
    purchaseConfirmBtn: document.getElementById('purchase-confirm-btn'),
    purchaseDeclineBtn: document.getElementById('purchase-decline-btn'),
    auctionModal: document.getElementById('auction-modal'),
    auctionPropertyName: document.getElementById('auction-property-name'),
    auctionCurrentBid: document.getElementById('auction-current-bid'),
    auctionBidInput: document.getElementById('auction-bid-input'),
    auctionBidBtn: document.getElementById('auction-bid-btn'),

    centerStartBtn: document.getElementById('center-start-btn'),
    startGameOverlay: document.getElementById('start-game-overlay'),
    rollDiceBtn: document.getElementById('roll-dice-btn'),
    endTurnBtn: document.getElementById('end-turn-btn'),
    turnActions: document.getElementById('turn-actions'),
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
    clientId: null,
    isHost: false,
    currentPlayerIsMe: false
  };
  const gameState = {
    started: false,
    currentPlayerId: null,
    lastDice: [0, 0],
    auctionActive: false,
    awaitingDecision: false
  };

  const socket = io();
  const disposers = [];

  function on(target, event, handler, options) {
    target.addEventListener(event, handler, options);
    disposers.push(() => target.removeEventListener(event, handler, options));
  }

  function getClientId() {
    const existing = localStorage.getItem('poorup-client-id');
    if (existing) return existing;
    const generated = `client-${Math.random().toString(36).slice(2, 11)}`;
    localStorage.setItem('poorup-client-id', generated);
    return generated;
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

  function appendActivity(text) {
    // Activity log removed from UI; messages go to chat only
  }

  function formatDice(lastDice) {
    if (!Array.isArray(lastDice) || lastDice.length !== 2) {
      return 'Dice: --';
    }
    const [a, b] = lastDice;
    if (!a && !b) return 'Dice: --';
    return `Dice: ${a} + ${b} = ${a + b}`;
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
    modal?.classList.remove('hidden');
  }

  function hideModal(modal) {
    modal?.classList.add('hidden');
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
    if (player?.clientId && player.clientId === localState.clientId && selectedColor) {
      return selectedColor;
    }
    return player.color || '#84cc16';
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
      const status = player.bankrupt ? 'Bankrupt' : player.disconnected ? 'Away' : 'Ready';
      card.className = [
        'player-card',
        isActive ? 'active' : '',
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
    if (!gameState.started || !localState.currentPlayerIsMe || gameState.auctionActive || gameState.awaitingDecision) {
      elements.rollDiceBtn.classList.add('hidden');
      elements.endTurnBtn.classList.add('hidden');
      elements.turnActions.classList.add('hidden');
      return;
    }

    elements.rollDiceBtn.classList.remove('hidden');
    elements.endTurnBtn.classList.remove('hidden');
    elements.turnActions.classList.remove('hidden');
  }

  function setTurnBanner(game, vacationPool = 0) {
    if (!game?.started) {
      const waitingText = localState.isHost
        ? 'You are the host.'
        : 'Waiting for the host to start the game.';
      if (elements.turnBannerTitle) elements.turnBannerTitle.textContent = 'Lobby';
      if (elements.turnBannerSubtitle) elements.turnBannerSubtitle.textContent = waitingText;
      if (elements.diceDisplay) elements.diceDisplay.textContent = 'Dice: --';
      if (elements.vacationDisplay) elements.vacationDisplay.textContent = `Vacation: $${vacationPool}`;
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
      elements.turnBannerTitle.textContent = current
        ? (localState.currentPlayerIsMe ? 'Your turn' : `${current.nickname}'s turn`)
        : 'Game in progress';
    }
    if (elements.turnBannerSubtitle) {
      const subtitle = localState.currentPlayerIsMe
        ? 'Roll the dice, resolve the tile, then end your turn.'
        : 'Watch the active player and wait for your turn.';
      elements.turnBannerSubtitle.textContent = subtitle;
    }
    if (elements.diceDisplay) {
      elements.diceDisplay.textContent = formatDice(game.lastDice);
    }
    if (elements.vacationDisplay) {
      elements.vacationDisplay.textContent = `Vacation: $${vacationPool}`;
    }
    updateTurnButtons();
  }

  function renderBoardOwnership(tiles, players) {
    if (!elements.boardOwnershipLayer) return;

    elements.boardOwnershipLayer.innerHTML = '';
    if (!Array.isArray(tiles) || !tiles.length) return;

    const playerById = new Map((players || []).map(player => [player.id, player]));

    tiles.forEach(tile => {
      if (!tile.ownerId || (tile.type !== 'property' && tile.type !== 'utility')) {
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

    ownedTiles.forEach(tile => {
      const item = document.createElement('div');
      item.className = 'property-row';
      item.innerHTML = `
        <span>
          ${escapeHtml(tile.name)}
          <small class="muted" style="display:block; margin: 4px 0 0;">${escapeHtml(tile.group || tile.type)}${tile.mortgaged ? ' • Mortgaged' : ''}</small>
        </span>
        <strong>$${tile.rent || 0}</strong>
      `;
      elements.myPropertiesList.appendChild(item);
    });
  }

  function setTokens(players) {
    const tokenLayer = document.getElementById('token-layer');
    if (!tokenLayer) return;

    tokenLayer.innerHTML = '';
    const positions = {};

    players.forEach(player => {
      positions[player.position] = positions[player.position] || [];
      positions[player.position].push(player);
    });

    Object.values(positions).forEach(playersOnTile => {
      playersOnTile.forEach((player, index) => {
        const position = BOARD_POSITIONS[player.position % BOARD_POSITIONS.length] || { left: 50, top: 50 };
        const offset = getTokenOffset(index, playersOnTile.length);
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

  function getTokenOffset(index, total) {
    if (total <= 1) return { x: 0, y: 0 };

    const spacing = 16;
    const offsets = [
      { x: -spacing, y: -spacing },
      { x: spacing, y: -spacing },
      { x: -spacing, y: spacing },
      { x: spacing, y: spacing },
      { x: 0, y: -spacing * 1.6 },
      { x: 0, y: spacing * 1.6 },
      { x: -spacing * 1.6, y: 0 },
      { x: spacing * 1.6, y: 0 }
    ];

    return offsets[index % offsets.length];
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
      hideModal(elements.auctionModal);
      return;
    }

    const localPlayer = game?.players?.find(player => player.clientId === localState.clientId);
    const canBid = Boolean(localPlayer && !localPlayer.bankrupt && !localPlayer.disconnected);

    elements.auctionPropertyName.textContent = auction.tileName || 'Property';
    elements.auctionCurrentBid.textContent = `Current bid: $${auction.highestBid || 0}`;
    elements.auctionBidInput.min = String((auction.highestBid || 0) + 1);
    elements.auctionBidInput.value = String((auction.highestBid || 0) + 1);
    elements.auctionBidInput.disabled = !canBid;
    elements.auctionBidBtn.disabled = !canBid;
    showModal(elements.auctionModal);
  }

  function renderGameState(state) {
    if (!state) return;

    gameState.started = state.game.started;
    gameState.currentPlayerId = state.game.currentPlayerId;
    gameState.lastDice = state.game.lastDice || [0, 0];
    gameState.auctionActive = Boolean(state.game.auction?.active);
    gameState.awaitingDecision = Boolean(currentPurchase);

    setPlayerList(state.room.players, state.game.currentPlayerId, state.game.turnOrder);
    setTurnBanner(state.game, state.game.vacationPool || 0);
    setTokens(state.game.players);
    renderBoardOwnership(state.game.tiles, state.game.players);
    renderMyProperties(state.game.tiles, state.game.players);
    renderAuction(state.game.auction, state.game);
    if (elements.vacationBalance) {
      elements.vacationBalance.textContent = `$${state.game.vacationPool || 0}`;
    }

    if (elements.settingsWindow) {
      elements.settingsWindow.classList.toggle('hidden', state.room.started);
    }
    if (elements.propertiesWindow) {
      elements.propertiesWindow.classList.toggle('hidden', !state.room.started);
    }

    if (state.room.started) {
      elements.startGameOverlay?.classList.add('hidden');
    } else if (localState.isHost) {
      elements.startGameOverlay?.classList.remove('hidden');
    } else {
      elements.startGameOverlay?.classList.add('hidden');
    }

    syncPanelHeights();
  }

  function renderRoomState(state) {
    if (!state?.room || !state?.game) return;

    localState.room = state.room;
    localState.game = state.game;

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
  }

  function syncPanelHeights() {
    const height = elements.boardImage.getBoundingClientRect().height;
    if (!height || height < 100) {
      setTimeout(syncPanelHeights, 50);
      return;
    }

    const chatPanel = document.querySelector('.chat-panel');
    const propsPanel = document.querySelector('.properties-panel');
    if (chatPanel) chatPanel.style.height = `${height}px`;
    if (propsPanel) propsPanel.style.height = `${height}px`;
    if (elements.rightSidebar) elements.rightSidebar.style.height = `${height}px`;
  }

  function openPurchaseModal(data) {
    currentPurchase = data;
    gameState.awaitingDecision = true;
    if (!elements.purchaseModal) return;
    elements.purchaseName.textContent = data.name;
    elements.purchaseCost.textContent = `Cost: $${data.price}`;
    showModal(elements.purchaseModal);
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
      appendChat('Please enter a room code to join.', 'System');
      return;
    }

    emit('join-room', { nickname, color: selectedColor, roomCode }, response => {
      if (!response?.success) {
        appendChat(response?.error || 'Unable to join room.', 'System');
        return;
      }
      showLobbyScreen();
      setRoomCode(response.roomCode);
    });
  }

  function createRoom() {
    const nickname = elements.nicknameInput.value.trim() || 'Host';
    emit('create-room', { nickname, color: selectedColor }, response => {
      if (!response?.success) {
        appendChat(response?.error || 'Unable to create room.', 'System');
        return;
      }
      showLobbyScreen();
      setRoomCode(response.roomCode);
    });
  }

  function showLobbyScreen() {
    elements.landingScreen.classList.add('hidden');
    elements.mainWorkspace.classList.remove('hidden');
    showOverlay();
    appendChat('entered the room.', 'System');
  }

  function renderColors() {
    elements.colorGrids.forEach(grid => {
      grid.querySelectorAll('button').forEach(button => {
        button.classList.toggle('active', button.dataset.color === selectedColor);
      });
    });
  }

  function placeAuctionBid() {
    if (!elements.auctionBidInput) return;
    const amount = Number(elements.auctionBidInput.value);
    if (!Number.isFinite(amount) || amount <= 0) {
      appendChat('Enter a valid bid amount.', 'System');
      return;
    }

    emit('auction-bid', { amount }, response => {
      if (!response?.success) {
        appendChat(response?.error || 'Could not place bid.', 'System');
      }
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

  socket.on('connect', () => {
    localState.clientId = getClientId();
    emit('restore-session', {}, () => {});
  });

  socket.on('update-state', renderRoomState);

  socket.on('chat-message', ({ nickname, text }) => {
    appendChat(text, nickname);
  });

  socket.on('system-message', ({ text }) => {
    appendActivity(text);
    appendChat(text, 'System');
    showToast(text, 'info');
  });

  socket.on('purchase-offer', openPurchaseModal);

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
    appendChat(text, 'You');
    emit('send-chat', { text }, () => {});
    elements.chatInput.value = '';
  });

  if (elements.overlayContinueBtn) {
    on(elements.overlayContinueBtn, 'click', () => {
      const nickname = elements.nicknameInput.value.trim();
      syncAppearanceSelection(selectedColor, nickname).finally(() => {
        hideOverlay();
        elements.chatInput.focus();
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
      button.setAttribute('aria-label', `Select color ${color}`);
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
    on(elements.copyRoomBtn, 'click', () => {
      const text = elements.roomCodeValue?.textContent;
      if (navigator.clipboard && text) {
        navigator.clipboard.writeText(text);
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


  on(elements.rollDiceBtn, 'click', () => {
    if (!localState.currentPlayerIsMe) return;
    emit('roll-dice', {}, response => {
      if (!response?.success) {
        appendChat(response?.error || 'Unable to roll.', 'System');
      }
    });
  });

  on(elements.endTurnBtn, 'click', () => {
    if (!localState.currentPlayerIsMe) return;
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
        } else {
          showToast('Property purchased.', 'success');
        }
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

  if (elements.auctionBidBtn) {
    on(elements.auctionBidBtn, 'click', placeAuctionBid);
  }

  if (elements.auctionBidInput) {
    on(elements.auctionBidInput, 'keydown', event => {
      if (event.key === 'Enter') {
        event.preventDefault();
        placeAuctionBid();
      }
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
    hideModal(elements.purchaseModal);
    hideModal(elements.auctionModal);
    hideModal(elements.helpModal);
  });

  const onResize = () => {
    clearTimeout(window.syncPanelTimeout);
    window.syncPanelTimeout = setTimeout(syncPanelHeights, 100);
  };
  on(window, 'resize', onResize);

  elements.chatInput.focus();

  return () => {
    disposers.forEach(dispose => dispose());
    socket.off('connect');
    socket.off('update-state');
    socket.off('chat-message');
    socket.off('system-message');
    socket.off('purchase-offer');
    socket.disconnect();
  };
}

document.addEventListener('DOMContentLoaded', () => {
  initGameClient();
});
