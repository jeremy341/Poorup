// ==================== INITIAL CONFIGURATION ====================
const landingScreen = document.getElementById('landing-screen');
const mainWorkspace = document.getElementById('main-workspace');
const landingForm = document.getElementById('landing-form');
const nicknameInput = document.getElementById('nickname-input');

const colors = [
    '#bada55', '#ffcc33', '#ff8833', '#ee4444',
    '#88ccff', '#99ffff', '#00aa99', '#66cc33',
    '#a07050', '#cc3399', '#ff7788', '#9966cc'
];

let selectedColor = '#ffcc33'; // Default Yellow

// ==================== SCREEN SWITCHING ====================
landingForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const nickname = nicknameInput.value.trim();

    if (nickname !== '') {
        // Transition from Landing to Lobby
        landingScreen.classList.add('hidden');
        mainWorkspace.classList.remove('hidden');

        // Update welcome name in lobby
        document.querySelector('#center-column p').textContent = `Select your player appearance:`;
    }
});

// ==================== GAME START TRANSITION ====================
const joinLobbyBtn = document.getElementById('join-lobby-btn');
const boardContainer = document.getElementById('board-container');
const shareCard = document.getElementById('share-card');
const communityCard = document.getElementById('community-card');
const centerColumn = document.getElementById('center-column');
const rightColumn = document.getElementById('right-column');

joinLobbyBtn.addEventListener('click', () => {
    // 1. Unblur and scale the background board
    boardContainer.classList.remove('blurred');

    // 2. Hide Lobby Columns that block active gameplay
    shareCard.classList.add('hidden');
    communityCard.classList.add('hidden');
    centerColumn.classList.add('hidden');
    rightColumn.classList.add('hidden');
});

// ==================== COLOR GRID GENERATOR ====================
const colorGrid = document.getElementById('color-grid');

function renderColors() {
    colorGrid.innerHTML = ''; // Clear prior elements

    colors.forEach(color => {
        const circle = document.createElement('button');
        circle.className = 'color-circle';
        circle.style.backgroundColor = color;

        if (color === selectedColor) {
            circle.classList.add('active');

            // Inject character eyes inside the active selection
            circle.innerHTML = `
        <div class="active-eyes">
          <div class="eye"></div>
          <div class="eye"></div>
        </div>
      `;
        }

        circle.addEventListener('click', () => {
            selectedColor = color;
            renderColors(); // Redraw selection indicators
        });

        colorGrid.appendChild(circle);
    });
}

renderColors();

// ==================== DYNAMIC BOARD GRID GENERATION ====================
const gameBoard = document.getElementById('game-board');

function isEdge(row, col) {
    return row === 0 || row === 10 || col === 0 || col === 10;
}

function renderBoard() {
    gameBoard.innerHTML = '';

    // Render an 11x11 layout (121 boxes)
    for (let row = 0; row < 11; row++) {
        for (let col = 0; col < 11; col++) {
            const tile = document.createElement('div');
            tile.className = 'board-tile';

            if (isEdge(row, col)) {
                tile.classList.add('active-edge');
            }

            gameBoard.appendChild(tile);
        }
    }
}

renderBoard();

// ==================== INTERACTIVE TOGGLES ====================
document.querySelectorAll('.toggle').forEach(toggle => {
    toggle.addEventListener('click', () => {
        toggle.classList.toggle('active');
    });
});

// ==================== MODAL BEHAVIOR ====================
const mapModal = document.getElementById('map-modal');
const browseMapsBtn = document.getElementById('browse-maps-btn');
const closeModalBtn = document.getElementById('close-modal-btn');

browseMapsBtn.addEventListener('click', () => {
    mapModal.classList.remove('hidden');
});

closeModalBtn.addEventListener('click', () => {
    mapModal.classList.add('hidden');
});