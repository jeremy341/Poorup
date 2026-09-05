export function applyServerState(snapshot, clientId, previousState = {}) {
    if (!snapshot?.room || !snapshot?.game) return previousState;
    const serverTime = Number(snapshot.serverTime);
    const state = { ...previousState };
    if (Number.isFinite(serverTime) && serverTime > 0) state.serverTimeOffset = serverTime - Date.now();
    const { room, game } = snapshot;
    if (Object.prototype.hasOwnProperty.call(room, "roomCode")) state.roomCode = room.roomCode || "";
    state.roomVisibility = room.visibility === "public" ? "public" : "private";
    state.hostId = room.hostId || null;
    state.serverTiles = Array.isArray(game.tiles) ? game.tiles : [];
    const remotePlayers = Array.isArray(game.players) ? game.players : room.players || [];
    const turnOrder = Array.isArray(game.turnOrder) && game.turnOrder.length
        ? game.turnOrder
        : remotePlayers.map((player) => player.id);
    state.players = remotePlayers.map((player) => ({
        id: player.clientId === clientId ? "p1" : player.id,
        serverId: player.id,
        clientId: player.clientId,
        accountId: player.accountId || null,
        name: String(player.nickname || "PLAYER").toUpperCase(),
        color: player.color || "#cfa75f",
        pos: Number(player.position) || 0,
        cash: Number(player.cash) || 0,
        bankrupt: Boolean(player.bankrupt),
        inDebt: Boolean(player.inDebt),
        online: player.online !== false,
        turn: player.id === game.currentPlayerId,
        jailed: Boolean(player.jail?.turns > 0),
        properties: Array.isArray(player.properties) ? player.properties : [],
        playerContractIds: Array.isArray(player.playerContractIds) ? player.playerContractIds : [],
        token: player.token || "",
        moved: Boolean(player.justLanded)
    }));
    state.phase = game.phase || "waiting";
    state.roundNumber = game.roundNumber || 0;
    state.currentPlayerId = game.currentPlayerId || null;
    state.pendingPayment = game.pendingPayment || null;
    state.pendingDebt = game.pendingPayment || null;
    state.turnOrder = turnOrder;
    state.serverTimeOffset = state.serverTimeOffset || 0;
    return state;
}