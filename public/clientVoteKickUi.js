function escapeText(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;",
  })[character]);
}

function requestId(createRequestId) {
  return typeof createRequestId === "function"
    ? createRequestId("room-votekick")
    : `room-votekick-${globalThis.crypto?.randomUUID?.() || Date.now().toString(36)}`;
}

export function createVoteKickUi({
  container,
  emit = () => {},
  createRequestId,
  now = Date.now,
  schedule = setTimeout,
  cancel = clearTimeout,
} = {}) {
  let vote = null;
  let players = [];
  let serverOffset = 0;
  let timer = null;
  let pendingChoice = null;
  let lastStatus = "";
  let feedback = "";

  const clearTimer = () => {
    if (timer !== null) cancel(timer);
    timer = null;
  };

  const targetName = () => players.find(player => String(player.serverId || player.id) === String(vote?.targetPlayerId))?.name || "PLAYER";

  const render = () => {
    clearTimer();
    if (!container) return;
    if (!vote?.voteId && !vote?.confirmTargetId) {
      container.hidden = !feedback;
      container.innerHTML = feedback ? `<p class="room-vote-panel panel noise t-body" role="status" aria-live="polite">${escapeText(feedback)}</p>` : "";
      return;
    }
    container.hidden = false;
    if (vote?.confirmTargetId) {
      const target = players.find(player => String(player.serverId || player.id) === String(vote.confirmTargetId));
      const targetLabel = target?.name || "this player";
      container.innerHTML = `<section class="room-vote-panel panel noise" aria-labelledby="room-vote-title"><div class="room-vote-head"><div><span class="t-micro g400">ROOM VOTE · CONFIRM</span><h2 class="t-section g100" id="room-vote-title">Remove ${escapeText(targetLabel)}?</h2></div><button type="button" class="btn-dark" data-votekick-action="cancel"><span class="t-label f11">CANCEL</span></button></div><p class="t-body ink-2">If this vote passes during a game, the player leaves and the room settles their seat and obligations. This vote applies only to this room.</p><button type="button" class="cta-red room-vote-confirm" data-votekick-action="start"><span class="cta-text cta-text-sm">START VOTE KICK</span></button></section>`;
      return;
    }

    const status = String(vote.status || "active");
    const seconds = Math.max(0, Math.ceil((Number(vote.expiresAt) - (now() + serverOffset)) / 1000));
    const isOpen = status === "open" || status === "active";
    const isActive = isOpen && seconds > 0;
    const displayStatus = isOpen && seconds === 0 ? "expired" : status;
    const canVote = isActive && !pendingChoice;
    const resultCopy = status === "passed" ? "Vote passed. The room is settling this seat." : status === "failed" || displayStatus === "expired" ? "Vote closed without removing the player." : "If passed during a game, their seat and open obligations are settled by the room.";
    const previousStatus = lastStatus;
    lastStatus = status;
    container.innerHTML = `<section class="room-vote-panel panel noise" aria-labelledby="room-vote-title"><div class="room-vote-head"><div><span class="t-micro g400">ROOM VOTE · ${isActive ? "OPEN" : escapeText(displayStatus.toUpperCase())}</span><h2 class="t-section g100" id="room-vote-title">${escapeText(targetName())}</h2></div>${isActive ? `<span class="room-vote-expiry" aria-label="${seconds} seconds remaining">${seconds}s</span>` : ""}</div><div class="room-vote-counts"><div><span class="t-micro ink-3">YES</span><strong>${Number(vote.yesCount) || 0}</strong></div><div><span class="t-micro ink-3">NO</span><strong>${Number(vote.noCount) || 0}</strong></div><div><span class="t-micro ink-3">NEEDED</span><strong>${Number(vote.requiredYes) || 0}</strong></div></div><div class="room-vote-progress" role="progressbar" aria-label="Yes votes" aria-valuemin="0" aria-valuemax="${Number(vote.eligibleCount) || 0}" aria-valuenow="${Number(vote.yesCount) || 0}"><span style="width:${Math.min(100, Math.max(0, (Number(vote.yesCount) || 0) / Math.max(1, Number(vote.requiredYes) || 1) * 100))}%"></span></div><p class="t-body ink-2 room-vote-consequence">${escapeText(resultCopy)}</p>${isActive ? `<div class="room-vote-actions"><button type="button" class="cta-red" data-votekick-choice="yes" ${canVote ? "" : "disabled"}><span class="cta-text cta-text-sm">VOTE YES</span></button><button type="button" class="btn-dark" data-votekick-choice="no" ${canVote ? "" : "disabled"}><span class="t-label f11">VOTE NO</span></button></div>` : ""}<span class="sr-only" data-votekick-status role="status" aria-live="${previousStatus === status ? "off" : "polite"}">${previousStatus === status ? "" : escapeText(resultCopy)}</span></section>`;
    if (isActive) timer = schedule(render, 1000);
  };

  const emitVote = (eventName, payload, onDone) => {
    emit(eventName, payload, response => {
      if (response?.success === false) {
        pendingChoice = null;
        feedback = response.error || "The room vote could not be updated.";
      }
      if (typeof onDone === "function") onDone(response);
      if (response?.success === false) render();
    });
  };

  const onClick = event => {
    const choiceButton = event.target.closest?.("[data-votekick-choice]");
    if (choiceButton && !choiceButton.disabled && !pendingChoice && vote?.voteId) {
      pendingChoice = choiceButton.dataset.votekickChoice;
      render();
      emitVote("room-votekick-cast", {
        voteId: vote.voteId,
        choice: pendingChoice,
        requestId: requestId(createRequestId),
      }, response => { if (response?.success !== false) pendingChoice = choiceButton.dataset.votekickChoice; });
      return;
    }
    const action = event.target.closest?.("[data-votekick-action]")?.dataset.votekickAction;
    if (action === "cancel") {
      vote = null;
      feedback = "";
      render();
    } else if (action === "start" && vote?.confirmTargetId) {
      const targetPlayerId = vote.confirmTargetId;
      vote = null;
      render();
      emitVote("room-votekick-start", { targetPlayerId, requestId: requestId(createRequestId) });
    }
  };

  container?.addEventListener("click", onClick);
  return {
    requestStart(targetPlayerId, currentPlayers = players) {
      players = currentPlayers;
      feedback = "";
      vote = { confirmTargetId: targetPlayerId };
      render();
    },
    update(nextVote, nextPlayers = players, serverTime) {
      vote = nextVote || null;
      players = Array.isArray(nextPlayers) ? nextPlayers : [];
      feedback = "";
      if (Number.isFinite(Number(serverTime)) && Number(serverTime) > 0) serverOffset = Number(serverTime) - now();
      if (!vote) pendingChoice = null;
      render();
    },
    destroy() {
      clearTimer();
      container?.removeEventListener("click", onClick);
      if (container) { container.innerHTML = ""; container.hidden = true; }
      vote = null;
      players = [];
      pendingChoice = null;
    },
  };
}
