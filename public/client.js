const landingScreen = document.getElementById('landing-screen');
const mainWorkspace = document.getElementById('main-workspace');
const landingForm = document.getElementById('landing-form');
const nicknameInput = document.getElementById('nickname-input');
const roomCodeInput = document.getElementById('room-code-input');
const createBtn = document.getElementById('create-btn');
const chatMessages = document.getElementById('chat-messages');
const chatInput = document.getElementById('chat-input');
const colorGrids = document.querySelectorAll('.color-grid');
const setupOverlay = document.getElementById('setup-overlay');
const overlayContinueBtn = document.getElementById('overlay-continue-btn');
const boardPanel = document.querySelector('.board-panel');
const boardImage = document.getElementById('board-image');
const playerList = document.getElementById('player-list');
const activityList = document.getElementById('activity-list');
const activityLog = document.getElementById('activity-log');
const roomCodeBlock = document.getElementById('room-code');
const roomCodeValue = document.getElementById('room-code-value');
const copyRoomBtn = document.getElementById('copy-room-btn');
const turnBanner = document.getElementById('turn-banner');
const purchaseModal = document.getElementById('purchase-modal');
const purchaseName = document.getElementById('purchase-property-name');
const purchaseCost = document.getElementById('purchase-property-cost');
const purchaseConfirmBtn = document.getElementById('purchase-confirm-btn');
const purchaseDeclineBtn = document.getElementById('purchase-decline-btn');
const startGameBtn = document.getElementById('start-game-btn');
const centerStartBtn = document.getElementById('center-start-btn');
const startGameOverlay = document.getElementById('start-game-overlay');
const rollDiceBtn = document.getElementById('roll-dice-btn');
const buyPropertyBtn = document.getElementById('buy-property-btn');
const auctionPropertyBtn = document.getElementById('auction-property-btn');
const endTurnBtn = document.getElementById('end-turn-btn');
const turnActions = document.getElementById('turn-actions');
const propertyActions = document.getElementById('property-actions');

const settingsInputs = Array.from(document.querySelectorAll('.setting-toggle input, .custom-select[data-setting]'));

const colors = ['#111827', '#ef4444', '#f59e0b', '#84cc16', '#06b6d4', '#6366f1', '#a78bfa', '#fb7185'];
let selectedColor = colors[5];
let currentPurchase = null;
let localState = { room: null, game: null, clientId: null, isHost: false, currentPlayerIsMe: false };
let gameState = { started: false, currentPlayerId: null };

const socket = typeof io !== 'undefined' ? io(window.location.origin) : null;

const BOARD_POSITIONS = [
  { left: 90, top: 90 }, { left: 75, top: 90 }, { left: 60, top: 90 }, { left: 45, top: 90 }, { left: 30, top: 90 }, { left: 15, top: 90 },
  { left: 5, top: 75 }, { left: 5, top: 60 }, { left: 5, top: 45 }, { left: 5, top: 30 },
  { left: 15, top: 15 }, { left: 30, top: 10 }, { left: 45, top: 10 }, { left: 60, top: 10 }, { left: 75, top: 10 },
  { left: 90, top: 15 }, { left: 95, top: 30 }, { left: 95, top: 45 }, { left: 95, top: 60 }, { left: 95, top: 75 },
  { left: 85, top: 90 }, { left: 70, top: 90 }, { left: 55, top: 90 }, { left: 40, top: 90 }
];

function getClientId() {
  const existing = localStorage.getItem('poorup-client-id');
  if (existing) return existing;
  const generated = `client-${Math.random().toString(36).substr(2, 9)}`;
  localStorage.setItem('poorup-client-id', generated);
  return generated;
}

function escapeHtml(text) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function emit(event, payload = {}, callback) {
  if (!socket) return;
  const data = { ...payload, clientId: localState.clientId };
  if (callback) socket.emit(event, data, callback);
  else socket.emit(event, data);
}

function appendChat(text, who = 'System') {
  const line = document.createElement('div');
  line.className = 'chat-line';
  line.textContent = who ? `${who}: ${text}` : text;
  chatMessages.appendChild(line);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function appendActivity(text) {
  const line = document.createElement('div');
  line.className = 'activity-line';
  line.textContent = text;
  activityList.prepend(line);
  if (activityList.childElementCount > 20) {
    activityList.removeChild(activityList.lastElementChild);
  }
  if (activityLog.classList.contains('hidden')) {
    activityLog.classList.remove('hidden');
  }
}

function showOverlay() {
  setupOverlay.classList.remove('hidden');
  boardPanel.classList.add('blurred');
}

function hideOverlay() {
  setupOverlay.classList.add('hidden');
  boardPanel.classList.remove('blurred');
}

function setRoomCode(code) {
  if (!code) {
    roomCodeBlock.classList.add('hidden');
    return;
  }
  roomCodeValue.textContent = code;
  roomCodeBlock.classList.remove('hidden');
}

function showModal(modal) {
  modal.classList.remove('hidden');
}

function hideModal(modal) {
  modal.classList.add('hidden');
}

function getPlayerColor(player) {
  return player.color || '#84cc16';
}

function setPlayerList(players, currentPlayerId, turnOrder) {
  playerList.innerHTML = '';
  if (!players.length) {
    playerList.textContent = 'No players yet';
    return;
  }

  let orderedPlayers = [...players];
  if (turnOrder && turnOrder.length > 0) {
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
    card.className = `player-card${player.id === currentPlayerId ? ' active' : ''}`;
    const avatarColor = getPlayerColor(player);
    card.innerHTML = `
      <div class="player-avatar" style="background:${avatarColor}"></div>
      <div class="player-info">
        <div class="player-name">${escapeHtml(player.nickname)}${player.isHost ? ' • Host' : ''}</div>
        <div class="player-meta">$${player.cash} • ${player.bankrupt ? 'Bankrupt' : player.disconnected ? 'Away' : 'Ready'}</div>
      </div>
    `;
    playerList.appendChild(card);
  });
}

function setTurnBanner(game) {
  if (!game || !game.started) {
    turnBanner.textContent = 'Waiting for the game to start.';
    rollDiceBtn.classList.add('hidden');
    buyPropertyBtn.classList.add('hidden');
    auctionPropertyBtn.classList.add('hidden');
    endTurnBtn.classList.add('hidden');
    return;
  }
  const current = game.players.find(player => player.id === game.currentPlayerId);
  turnBanner.textContent = current ? `${current.nickname}'s turn` : 'Waiting for next turn';
  const localPlayer = game.players.find(player => player.clientId === localState.clientId);
  localState.currentPlayerIsMe = !!(current && localPlayer && current.id === localPlayer.id);
  updateTurnButtons();
}

function updateTurnButtons() {
  if (!gameState.started) {
    rollDiceBtn.classList.add('hidden');
    buyPropertyBtn.classList.add('hidden');
    auctionPropertyBtn.classList.add('hidden');
    endTurnBtn.classList.add('hidden');
    return;
  }
  
  if (localState.currentPlayerIsMe) {
    rollDiceBtn.classList.remove('hidden');
    turnActions.classList.remove('hidden');
  } else {
    rollDiceBtn.classList.add('hidden');
    buyPropertyBtn.classList.add('hidden');
    auctionPropertyBtn.classList.add('hidden');
    endTurnBtn.classList.add('hidden');
    turnActions.classList.add('hidden');
    propertyActions.classList.add('hidden');
  }
}

function setTokens(players) {
  const tokenLayer = document.getElementById('token-layer');
  tokenLayer.innerHTML = '';
  const positions = {};
  players.forEach(player => {
    positions[player.position] = positions[player.position] || [];
    positions[player.position].push(player);
  });
  Object.entries(positions).forEach(([positionKey, playersOnTile]) => {
    playersOnTile.forEach((player, index) => {
      const position = BOARD_POSITIONS[player.position % BOARD_POSITIONS.length] || { left: 50, top: 50 };
      const token = document.createElement('div');
      token.className = 'player-token';
      token.textContent = player.nickname.charAt(0).toUpperCase();
      token.style.left = `${position.left}%`;
      token.style.top = `${position.top}%`;
      const offset = (index - (playersOnTile.length - 1) / 2) * 18;
      token.style.transform = `translate(calc(-50% + ${offset}px), -50%)`;
      token.style.background = getPlayerColor(player);
      tokenLayer.appendChild(token);
    });
  });
}

function renderSettings(settings, isHost) {
  if (!settings) return;
  
  // Directly find all setting inputs and selects
  const toggleInputs = Array.from(document.querySelectorAll('.setting-toggle input'));
  const selectElements = Array.from(document.querySelectorAll('.custom-select[data-setting]'));
  const allInputs = [...toggleInputs, ...selectElements];
  
  allInputs.forEach(input => {
    const key = input.dataset.setting;
    if (!key) return;
    if (input.type === 'checkbox') {
      input.checked = Boolean(settings[key]);
    } else if (input.tagName === 'SELECT') {
      input.value = settings[key];
    }
    input.disabled = !isHost;
  });
}

function renderGameState(state) {
  if (!state) return;
  gameState.started = state.game.started;
  gameState.currentPlayerId = state.game.currentPlayerId;
  
  const localPlayer = state.room.players.find(player => player.clientId === localState.clientId);
  setPlayerList(state.room.players, state.game.currentPlayerId, state.game.turnOrder);
  setTurnBanner(state.game);
  setTokens(state.game.players);
  
  if (state.room.started) {
    startGameBtn.classList.add('hidden');
    startGameOverlay.classList.add('hidden');
  } else {
    if (localState.isHost) {
      startGameBtn.classList.remove('hidden');
      startGameOverlay.classList.remove('hidden');
    } else {
      startGameBtn.classList.add('hidden');
      startGameOverlay.classList.add('hidden');
    }
  }
  syncPanelHeights();
}

function renderRoomState(state) {
  if (!state) return;
  localState.room = state.room;
  localState.game = state.game;
  
  // Ensure clientId is set - if not, get it from localStorage
  if (!localState.clientId) {
    localState.clientId = getClientId();
  }
  
  // Determine if current player is host - check isHost property first, then fallback to hostId
  const currentPlayer = state.room.players.find(p => p.clientId === localState.clientId);
  localState.isHost = (currentPlayer?.isHost === true) || 
                       (currentPlayer && state.room.hostId && currentPlayer.id === state.room.hostId);
  
  setRoomCode(state.room.roomCode);
  renderSettings(state.room.settings, localState.isHost);
  renderGameState(state);
}

function syncPanelHeights() {
  const height = boardImage?.getBoundingClientRect()?.height;
  if (!height || height < 100) {
    setTimeout(syncPanelHeights, 50);
    return;
  }
  const chatPanel = document.querySelector('.chat-panel');
  const propsPanel = document.querySelector('.properties-panel');
  if (chatPanel) chatPanel.style.height = `${height}px`;
  if (propsPanel) propsPanel.style.height = `${height}px`;
}

function openPurchaseModal(data) {
  currentPurchase = data;
  purchaseName.textContent = data.name;
  purchaseCost.textContent = `Cost: $${data.price}`;
  showModal(purchaseModal);
}

function closePurchaseModal() {
  currentPurchase = null;
  hideModal(purchaseModal);
}

function joinRoom() {
  const nickname = nicknameInput.value.trim();
  const roomCode = roomCodeInput.value.trim();
  if (!nickname) {
    nicknameInput.focus();
    return;
  }
  if (!roomCode) {
    appendChat('Please enter a room code to join.', 'System');
    return;
  }
  emit('join-room', { nickname, color: selectedColor, roomCode }, response => {
    if (!response.success) {
      appendChat(response.error || 'Unable to join room.', 'System');
      return;
    }
    showLobbyScreen();
    setRoomCode(response.roomCode);
  });
}

function createRoom() {
  const nickname = nicknameInput.value.trim() || 'Host';
  emit('create-room', { nickname, color: selectedColor }, response => {
    if (!response.success) {
      appendChat(response.error || 'Unable to create room.', 'System');
      return;
    }
    showLobbyScreen();
    setRoomCode(response.roomCode);
  });
}

function showLobbyScreen() {
  landingScreen.classList.add('hidden');
  mainWorkspace.classList.remove('hidden');
  showOverlay();
  appendChat('entered the room.', 'System');
}

if (socket) {
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
  });

  socket.on('purchase-offer', data => {
    openPurchaseModal(data);
  });
}

landingForm.addEventListener('submit', event => {
  event.preventDefault();
  joinRoom();
});

if (createBtn) {
  createBtn.addEventListener('click', createRoom);
}

chatInput.addEventListener('keydown', event => {
  if (event.key !== 'Enter') return;
  const text = chatInput.value.trim();
  if (!text) return;
  appendChat(text, 'You');
  emit('send-chat', { text }, () => {});
  chatInput.value = '';
});

overlayContinueBtn.addEventListener('click', () => {
  hideOverlay();
  chatInput.focus();
});

colorGrids.forEach(grid => {
  grid.innerHTML = '';
  colors.forEach(color => {
    const button = document.createElement('button');
    button.className = 'color-circle';
    button.style.background = color;
    button.addEventListener('click', () => {
      selectedColor = color;
      renderColors();
    });
    if (selectedColor === color) {
      button.classList.add('active');
    }
    grid.appendChild(button);
  });
});

function renderColors() {
  colorGrids.forEach(grid => {
    grid.querySelectorAll('button').forEach(button => {
      button.classList.toggle('active', button.style.background === selectedColor);
    });
  });
}

renderColors();

copyRoomBtn.addEventListener('click', () => {
  const text = roomCodeValue.textContent;
  if (navigator.clipboard && text) {
    navigator.clipboard.writeText(text);
  }
});

centerStartBtn.addEventListener('click', () => {
  if (localState.isHost) {
    emit('start-game', {}, response => {
      if (!response.success) {
        appendChat(response.error || 'Could not start game.', 'System');
      }
    });
  }
});

startGameBtn.addEventListener('click', () => {
  if (localState.isHost) {
    emit('start-game', {}, response => {
      if (!response.success) {
        appendChat(response.error || 'Could not start game.', 'System');
      }
    });
  }
});

rollDiceBtn.addEventListener('click', () => {
  if (localState.currentPlayerIsMe) {
    emit('roll-dice', {}, response => {
      if (!response.success) {
        appendChat(response.error || 'Unable to roll.', 'System');
      }
    });
  }
});

buyPropertyBtn.addEventListener('click', () => {
  if (!currentPurchase || !localState.currentPlayerIsMe) return;
  emit('purchase-property', { tileIndex: currentPurchase.tileIndex }, response => {
    if (!response.success) {
      appendChat(response.error || 'Could not complete purchase.', 'System');
    }
    closePurchaseModal();
  });
});

auctionPropertyBtn.addEventListener('click', () => {
  if (!currentPurchase || !localState.currentPlayerIsMe) return;
  emit('decline-property', { tileIndex: currentPurchase.tileIndex }, response => {
    if (!response.success) {
      appendChat(response.error || 'Could not start auction.', 'System');
    }
    closePurchaseModal();
  });
});

purchaseConfirmBtn.addEventListener('click', () => {
  if (!currentPurchase) return;
  emit('purchase-property', { tileIndex: currentPurchase.tileIndex }, response => {
    if (!response.success) {
      appendChat(response.error || 'Could not complete purchase.', 'System');
    }
    closePurchaseModal();
  });
});

purchaseDeclineBtn.addEventListener('click', () => {
  if (!currentPurchase) return;
  emit('decline-property', { tileIndex: currentPurchase.tileIndex }, response => {
    if (!response.success) {
      appendChat(response.error || 'Could not decline property.', 'System');
    }
    closePurchaseModal();
  });
});

endTurnBtn.addEventListener('click', () => {
  if (localState.currentPlayerIsMe) {
    emit('end-turn', {}, response => {
      if (!response.success) {
        appendChat(response.error || 'Could not end turn.', 'System');
      }
    });
  }
});

settingsInputs.forEach(input => {
  input.addEventListener('change', () => {
    if (!localState.isHost) return;
    const key = input.dataset.setting;
    if (!key) return;
    const value = input.type === 'checkbox' ? input.checked : input.value;
    emit('set-setting', { key, value }, response => {
      if (!response.success) {
        appendChat(response.error || 'Unable to update setting.', 'System');
      }
    });
  });
});

boardImage.addEventListener('load', syncPanelHeights);
if (boardImage.complete) {
  setTimeout(syncPanelHeights, 100);
}

window.addEventListener('resize', () => {
  clearTimeout(window.syncPanelTimeout);
  window.syncPanelTimeout = setTimeout(syncPanelHeights, 100);
});

if (chatInput) chatInput.focus();
