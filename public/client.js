const socket = io();

const joinForm = document.querySelector("#join-form");
const nameInput = document.querySelector("#name-input");
const joinBtn = document.querySelector(".join-btn");
const playerList = document.querySelector("#player-list");
const playerCount = document.querySelector("#player-count");
const roomLink = document.querySelector("#room-link");
const copyRoomLinkBtn = document.querySelector("#copy-room-link");
const chatForm = document.querySelector("#chat-form");
const chatInput = document.querySelector("#chat-input");
const chatBox = document.querySelector(".chat-box");
const mapModal = document.querySelector("#map-modal");
const closeMapButtons = document.querySelectorAll("[data-close-map]");
const settingsRows = document.querySelectorAll("[data-setting]");
const startingCashSelect = document.querySelector("#starting-cash");
const welcomeMessage = document.querySelector("#welcome-message");
const landingScreen = document.querySelector("#landing-screen");
const lobbyScreen = document.querySelector("#Lobby-screen");

let selectedColor = "red";
let nameSubmitted = false;
let roomJoined = false;
const lobbySettings = {
    maxPlayers: 4,
    privateRoom: true,
    allowBots: false,
    onlyLoggedIn: false,
    x2Rent: false,
    vacationCash: false,
    auction: false,
    prisonRent: false,
    mortgage: false,
    evenBuild: true,
    randomizeOrder: true,
    startingCash: 1500,
};

roomLink.value = window.location.href;
roomLink.readOnly = true;

joinForm.addEventListener("submit", (e) => {
    e.preventDefault();

    if (nameSubmitted) {
        return;
    }

    const name = nameInput.value.trim();
    if (!name) {
        return;
    }

    socket.emit("join-game", name);
    nameSubmitted = true;
});

socket.on("welcome-message", (name) => {
    welcomeMessage.textContent = `Welcome, ${name}!`;
    landingScreen.classList.add("hidden");
    lobbyScreen.classList.remove("hidden");
});

document.querySelectorAll(".color").forEach((circle) => {
    circle.addEventListener("click", () => {
        document.querySelectorAll(".color").forEach((item) => item.classList.remove("selected"));
        circle.classList.add("selected");
        selectedColor = circle.id.replace("color-", "");
    });
});

joinBtn.addEventListener("click", () => {
    if (roomJoined) {
        return;
    }

    socket.emit("join-room", selectedColor);
    roomJoined = true;
    joinBtn.disabled = true;
    joinBtn.textContent = "Joined";
});

copyRoomLinkBtn.addEventListener("click", async () => {
    try {
        await navigator.clipboard.writeText(roomLink.value);
        copyRoomLinkBtn.textContent = "Copied";
        window.setTimeout(() => {
            copyRoomLinkBtn.textContent = "Copy";
        }, 1200);
    } catch (error) {
        roomLink.focus();
        roomLink.select();
        const copied = document.execCommand("copy");
        if (copied) {
            copyRoomLinkBtn.textContent = "Copied";
            window.setTimeout(() => {
                copyRoomLinkBtn.textContent = "Copy";
            }, 1200);
        } else {
            console.error("Could not copy room link:", error);
        }
    }
});

const openMapModal = () => {
    mapModal.classList.remove("hidden");
    mapModal.setAttribute("aria-hidden", "false");
};

const closeMapModal = () => {
    mapModal.classList.add("hidden");
    mapModal.setAttribute("aria-hidden", "true");
};

closeMapButtons.forEach((button) => {
    button.addEventListener("click", closeMapModal);
});

document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !mapModal.classList.contains("hidden")) {
        closeMapModal();
    }
});

const syncSettingsUI = () => {
    settingsRows.forEach((row) => {
        const key = row.dataset.setting;
        if (key === "boardMap" || key === "maxPlayers") {
            return;
        }

        const enabled = Boolean(lobbySettings[key]);

        row.setAttribute("aria-pressed", String(enabled));

        const switchEl = row.querySelector(".setting-switch");
        if (switchEl) {
            switchEl.classList.toggle("setting-switch--on", enabled);
        }
    });

    const maxPlayersRow = document.querySelector('[data-setting="maxPlayers"] .setting-value');
    if (maxPlayersRow) {
        maxPlayersRow.textContent = String(lobbySettings.maxPlayers);
    }
};

settingsRows.forEach((row) => {
    const key = row.dataset.setting;

    row.addEventListener("click", () => {
        if (key === "boardMap") {
            openMapModal();
            return;
        }

        if (key === "maxPlayers") {
            const values = [4, 6, 8];
            const currentIndex = values.indexOf(lobbySettings.maxPlayers);
            lobbySettings.maxPlayers = values[(currentIndex + 1) % values.length];
            syncSettingsUI();
            return;
        }

        if (!Object.prototype.hasOwnProperty.call(lobbySettings, key)) {
            return;
        }

        lobbySettings[key] = !lobbySettings[key];
        syncSettingsUI();
    });
});

startingCashSelect.addEventListener("change", () => {
    lobbySettings.startingCash = Number(startingCashSelect.value);
});

syncSettingsUI();

socket.on("update-players", (players) => {
    playerList.innerHTML = "";
    playerCount.textContent = `${players.length} joined`;

    if (!players.length) {
        const emptyItem = document.createElement("li");
        emptyItem.className = "empty-state";
        emptyItem.textContent = "No players joined yet";
        playerList.appendChild(emptyItem);
        return;
    }

    players.forEach((player) => {
        const item = document.createElement("li");
        item.className = "player-item";
        item.dataset.playerId = player.id || "";

        const colorDot = document.createElement("span");
        colorDot.className = "player-dot";
        colorDot.style.backgroundColor = player.color || "white";

        const name = document.createElement("span");
        name.className = "player-name";
        name.textContent = player.name;

        item.appendChild(colorDot);
        item.appendChild(name);
        playerList.appendChild(item);
    });
});

chatForm.addEventListener("submit", (e) => {
    e.preventDefault();

    const message = chatInput.value.trim();
    if (!message) {
        return;
    }

    socket.emit("send-message", message);
    chatInput.value = "";
    chatInput.focus();
});

socket.on("receive-message", (payload) => {
    const { name, color, message } = payload;
    if (!message) {
        return;
    }

    const messageRow = document.createElement("p");
    messageRow.className = "chat-message";

    const sender = document.createElement("span");
    sender.className = "chat-message__sender";
    sender.style.color = color || "white";
    sender.textContent = `${name}: `;

    messageRow.appendChild(sender);
    messageRow.appendChild(document.createTextNode(message));

    chatBox.querySelector(".empty-state")?.remove();
    chatBox.appendChild(messageRow);
    chatBox.scrollTop = chatBox.scrollHeight;
});
