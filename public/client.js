const socket = io();

const form = document.querySelector("form");
const input = document.querySelector(".name-input");
const joinBtn = document.querySelector(".join-btn");
const playerList = document.querySelector("#player-list");
let selectedColor = "red";

form.addEventListener("submit", (e) => {
    e.preventDefault();
    const name = input.value;
    socket.emit("join-game", name);
});

socket.on("welcome-message", (name) => {
    document.querySelector("#welcome-message").innerText = `Welcome, ${name}!`;

    // STARTSEITE VERSTECKEN:
    document.querySelector("#landing-screen").classList.add("hidden");

    // LOBBY ANZEIGEN:
    document.querySelector("#Lobby-screen").classList.remove("hidden");
});

const colorCircles = document.querySelectorAll(".color");

colorCircles.forEach(circle => {
    circle.addEventListener("click", () => {
        colorCircles.forEach(c => c.classList.remove("selected"));
        circle.classList.add("selected");
        selectedColor = circle.id.replace("color-", "");
    });
});

joinBtn.addEventListener("click", () => {
    socket.emit("join-room", selectedColor);
});

socket.on("update-players", (players) => {
    playerList.innerHTML = "";

    players.forEach((player) => {
        const li = document.createElement("li");
        li.textContent = player.name;
        li.style.color = player.color;
        playerList.appendChild(li);
    });
});
