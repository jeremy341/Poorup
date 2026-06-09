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
const welcomeMessage = document.querySelector("#welcome-message");
const landingScreen = document.querySelector("#landing-screen");
const lobbyScreen = document.querySelector("#Lobby-screen");

let selectedColor = "red";

roomLink.value = window.location.href;

joinForm.addEventListener("submit", (e) => {
    e.preventDefault();

    const name = nameInput.value.trim();
    if (!name) {
        return;
    }

    socket.emit("join-game", name);
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
    socket.emit("join-room", selectedColor);
});

copyRoomLinkBtn.addEventListener("click", async () => {
    try {
        await navigator.clipboard.writeText(roomLink.value);
        copyRoomLinkBtn.textContent = "Copied";
        window.setTimeout(() => {
            copyRoomLinkBtn.textContent = "Copy";
        }, 1200);
    } catch (error) {
        console.error("Could not copy room link:", error);
    }
});

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
