import { applyServerState } from '../public/client-state.js';

let pass = 0;
let fail = 0;
function check(name, fn) {
    try { fn(); pass++; } catch (e) { fail++; console.error(`FAIL — ${name}\n  ${e.message}`); }
}

const basicSnapshot = {
    room: { roomCode: "ABC123", visibility: "public", hostId: "host1" },
    game: {
        tiles: [{ index: 0, name: "Go", type: "go" }],
        players: [
            { id: "p1", clientId: "client1", nickname: "Alice", cash: 1500, position: 0, color: "#ff0000", online: true, properties: [], playerContractIds: [], bankrupt: false, token: "car" },
            { id: "p2", clientId: "client2", nickname: "Bob", cash: 1500, position: 0, color: "#0000ff", online: true, properties: [], playerContractIds: [], bankrupt: false, token: "hat" }
        ],
        currentPlayerId: "p1",
        phase: "playing",
        roundNumber: 1,
        turnOrder: ["p1", "p2"]
    }
};

check('transforms basic snapshot', () => {
    const state = applyServerState(basicSnapshot, "client1");
    if (state.roomCode !== "ABC123") throw new Error(`Expected ABC123, got ${state.roomCode}`);
    if (state.players.length !== 2) throw new Error(`Expected 2 players, got ${state.players.length}`);
    if (state.players[0].id !== "p1") throw new Error(`Expected p1, got ${state.players[0].id}`);
    if (state.players[0].name !== "ALICE") throw new Error(`Expected ALICE, got ${state.players[0].name}`);
    if (state.players[0].cash !== 1500) throw new Error(`Expected 1500, got ${state.players[0].cash}`);
    if (state.phase !== "playing") throw new Error(`Expected playing, got ${state.phase}`);
    if (state.roundNumber !== 1) throw new Error(`Expected 1, got ${state.roundNumber}`);
});

check('clientId maps local player to p1', () => {
    const state = applyServerState(basicSnapshot, "client1");
    if (state.players[0].id !== "p1") throw new Error(`Local player should be p1, got ${state.players[0].id}`);
    if (state.players[0].serverId !== "p1") throw new Error(`Server ID should be p1, got ${state.players[0].serverId}`);
});

check('non-local player keeps original id', () => {
    const state = applyServerState(basicSnapshot, "client1");
    if (state.players[1].id !== "p2") throw new Error(`Remote player should keep p2, got ${state.players[1].id}`);
});

check('null snapshot returns previous state', () => {
    const prev = { roomCode: "OLD" };
    const state = applyServerState(null, "client1", prev);
    if (state.roomCode !== "OLD") throw new Error(`Should return previous state, got ${state.roomCode}`);
});

check('inDebt flag is mapped', () => {
    const snap = JSON.parse(JSON.stringify(basicSnapshot));
    snap.game.players[0].inDebt = true;
    const state = applyServerState(snap, "client1");
    if (state.players[0].inDebt !== true) throw new Error(`inDebt should be true`);
});

check('bankrupt flag is mapped', () => {
    const snap = JSON.parse(JSON.stringify(basicSnapshot));
    snap.game.players[0].bankrupt = true;
    const state = applyServerState(snap, "client1");
    if (state.players[0].bankrupt !== true) throw new Error(`bankrupt should be true`);
});

check('pendingDebt mirrors pendingPayment', () => {
    const snap = JSON.parse(JSON.stringify(basicSnapshot));
    snap.game.pendingPayment = { playerId: "p1", creditorId: null, amountRemaining: 500, reason: "test" };
    const state = applyServerState(snap, "client1");
    if (!state.pendingDebt) throw new Error(`pendingDebt should be set`);
    if (state.pendingDebt.playerId !== "p1") throw new Error(`pendingDebt.playerId should be p1`);
    if (state.pendingDebt.amountRemaining !== 500) throw new Error(`pendingDebt.amountRemaining should be 500`);
});

console.log(`client-state tests: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);