const express = require("express");
const path = require("path");
const http = require("http");
const { Server } = require("socket.io");
let activePlayers = {};



// Express App
const app = express();
const PORT = 3005;

// HTTP Server um Express wrappen
const server = http.createServer(app);

// Socket.io auf denselben Server
const io = new Server(server);

// statische Dateien
app.use(express.static(path.join(__dirname, "../public")));

// Socket Verbindung
io.on("connection", (socket) => {

    socket.on("join-game", (name) => {
        console.log(`Spieler ${name} game-joined!`);

        activePlayers[socket.id] = { name: name, color: "red" };

        socket.emit("welcome-message", name);
        io.emit(
            "update-players",
            Object.entries(activePlayers).map(([id, player]) => ({
                id,
                ...player,
            }))
        );
    });


    socket.on("join-room", (color) => {
        console.log(`Spieler ${socket.id} joined room with color ${color}`);

        if (activePlayers[socket.id]) {
            activePlayers[socket.id].color = color;
        }

        io.emit(
            "update-players",
            Object.entries(activePlayers).map(([id, player]) => ({
                id,
                ...player,
            }))
        );
    });

    socket.on("select-color", (color) => {
        console.log(`Ein Spieler hat die Farbe ${color} gewählt!`);
    });

    socket.on("disconnect", () => {
        console.log(`Spieler ${socket.id} hat die Verbindung getrennt.`);

        delete activePlayers[socket.id];
        io.emit(
            "update-players",
            Object.entries(activePlayers).map(([id, player]) => ({
                id,
                ...player,
            }))
        );
    });
    socket.on("send-message", (messageText) => {
        const sender = activePlayers[socket.id];
        if (sender) {
            io.emit("receive-message", {
                name: sender.name,
                color: sender.color,
                message: messageText
            });
        }
    });
});

server.listen(PORT, () => {
    console.log(`Server läuft auf http://localhost:${PORT}`);
});


