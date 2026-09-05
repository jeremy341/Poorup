import { applyServerState } from '../public/client-state.js';

let pass = 0;
let fail = 0;
function testEqual(name, fn) {
    try { fn(); pass++; } catch (e) { fail++; console.error(`FAIL - ${name}\n  ${e.message}`); }
}

function assertEqual(actual, expected, message) {
    if (actual !== expected) throw new Error(`${message}: expected ${expected}, got ${actual}`);
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

testEqual('transforms basic snapshot', () => {
    const state = applyServerState(basicSnapshot, "client1");
    assertEqual(state.roomCode, "ABC123", "roomCode");
    assertEqual(state.players.length, 2, "players.length");
    assertEqual(state.players[0].id, "p1", "players[0].id");
    assertEqual(state.players[0].name, "ALICE", "players[0].name");
    assertEqual(state.players[0].cash, 1500, "players[0].cash");
    assertEqual(state.phase, "playing", "phase");
    assertEqual(state.roundNumber, 1, "roundNumber");
});

testEqual('clientId maps local player to p1', () => {
    const state = applyServerState(basicSnapshot, "client1");
    assertEqual(state.players[0].id, "p1", "Local player should be p1");
    assertEqual(state.players[0].serverId, "p1", "Server ID should be p1");
});

testEqual('non-local player keeps original id', () => {
    const state = applyServerState(basicSnapshot, "client1");
    assertEqual(state.players[1].id, "p2", "Remote player should keep p2");
});

testEqual('null snapshot returns previous state', () => {
    const prev = { roomCode: "OLD" };
    const state = applyServerState(null, "client1", prev);
    assertEqual(state.roomCode, "OLD", "Should return previous state");
});

testEqual('inDebt flag is mapped', () => {
    const snap = JSON.parse(JSON.stringify(basicSnapshot));
    snap.game.players[0].inDebt = true;
    const state = applyServerState(snap, "client1");
    assertEqual(state.players[0].inDebt, true, "inDebt should be true");
});

testEqual('bankrupt flag is mapped', () => {
    const snap = JSON.parse(JSON.stringify(basicSnapshot));
    snap.game.players[0].bankrupt = true;
    const state = applyServerState(snap, "client1");
    assertEqual(state.players[0].bankrupt, true, "bankrupt should be true");
});

testEqual('pendingDebt mirrors pendingPayment', () => {
    const snap = JSON.parse(JSON.stringify(basicSnapshot));
    snap.game.pendingPayment = { playerId: "p1", creditorId: null, amountRemaining: 500, reason: "test" };
    const state = applyServerState(snap, "client1");
    assertEqual(!!state.pendingDebt, true, "pendingDebt should be set");
    assertEqual(state.pendingDebt.playerId, "p1", "pendingDebt.playerId should be p1");
    assertEqual(state.pendingDebt.amountRemaining, 500, "pendingDebt.amountRemaining should be 500");
});

console.log(`client-state tests: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);