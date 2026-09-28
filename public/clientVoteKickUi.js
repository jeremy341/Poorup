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

function voteDisplay(vote, currentTime) {
  const status = String(vote.status || "active");
  const seconds = Math.max(0, Math.ceil((Number(vote.expiresAt) - currentTime) / 1000));
  const isOpen = status === "open" || status === "active";
  const isActive = isOpen && seconds > 0;
  const displayStatus = isOpen && seconds === 0 ? "expired" : status;
  return { status, seconds, isActive, displayStatus };
}

function voteResultCopy(status, displayStatus) {
  if (status === "passed") return "Vote passed. The room is settling this seat.";
  if (status === "failed" || displayStatus === "expired") return "Vote closed without removing the player.";
  return "If passed during a game, their seat and open obligations are settled by the room.";
}

function voteActionMarkup(canVote) {
  if (!canVote) return "disabled";
  return "";
}

function voteAnnouncement(previousStatus, status, resultCopy) {
  const changed = previousStatus !== status;
  return `<span class="sr-only" data-votekick-status role="status" aria-live="${changed ? "polite" : "off"}">${changed ? escapeText(resultCopy) : ""}</span>`;
}

function voteProgress(vote) {
  const yesCount = Number(vote.yesCount) || 0;
  const needed = Number(vote.requiredYes) || 1;
  return Math.min(100, Math.max(0, yesCount / needed * 100));
}

function voteCount(value) {
  return Number(value) || 0;
}

function votePanelMarkup({ vote, details, canVote, resultCopy, previousStatus }) {
  const statusLabel = details.isActive ? "OPEN" : escapeText(details.displayStatus.toUpperCase());
  const expiry = details.isActive
    ? `<span class="room-vote-expiry" aria-label="${details.seconds} seconds remaining">${details.seconds}s</span>`
    : "";
  const actions = details.isActive
    ? `<div class="room-vote-actions"><button type="button" class="cta-red" data-votekick-choice="yes" ${voteActionMarkup(canVote)}><span class="cta-text cta-text-sm">VOTE YES</span></button><button type="button" class="btn-dark" data-votekick-choice="no" ${voteActionMarkup(canVote)}><span class="t-label f11">VOTE NO</span></button></div>`
    : "";
  const eligibleCount = voteCount(vote.eligibleCount);
  return `<section class="room-vote-panel panel noise" aria-labelledby="room-vote-title"><div class="room-vote-head"><div><span class="t-micro g400">ROOM VOTE · ${statusLabel}</span><h2 class="t-section g100" id="room-vote-title">${escapeText(details.targetName)}</h2></div>${expiry}</div><div class="room-vote-counts"><div><span class="t-micro ink-3">YES</span><strong>${voteCount(vote.yesCount)}</strong></div><div><span class="t-micro ink-3">NO</span><strong>${voteCount(vote.noCount)}</strong></div><div><span class="t-micro ink-3">NEEDED</span><strong>${voteCount(vote.requiredYes)}</strong></div></div><div class="room-vote-progress" role="progressbar" aria-label="Yes votes" aria-valuemin="0" aria-valuemax="${eligibleCount}" aria-valuenow="${voteCount(vote.yesCount)}"><span style="width:${voteProgress(vote)}%"></span></div><p class="t-body ink-2 room-vote-consequence">${escapeText(resultCopy)}</p>${actions}${voteAnnouncement(previousStatus, details.status, resultCopy)}</section>`;
}

function canSubmitVoteChoice(button, pendingChoice, vote) {
  return [Boolean(button), !button?.disabled, !pendingChoice, Boolean(vote?.voteId)].every(Boolean);
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

  const renderFeedback = () => {
    container.hidden = !feedback;
    container.innerHTML = feedback ? `<p class="room-vote-panel panel noise t-body" role="status" aria-live="polite">${escapeText(feedback)}</p>` : "";
  };

  const renderConfirmation = () => {
    const target = players.find(player => String(player.serverId || player.id) === String(vote.confirmTargetId));
    const targetLabel = target?.name || "this player";
    container.innerHTML = `<section class="room-vote-panel panel noise" aria-labelledby="room-vote-title"><div class="room-vote-head"><div><span class="t-micro g400">ROOM VOTE · CONFIRM</span><h2 class="t-section g100" id="room-vote-title">Remove ${escapeText(targetLabel)}?</h2></div><button type="button" class="btn-dark" data-votekick-action="cancel"><span class="t-label f11">CANCEL</span></button></div><p class="t-body ink-2">If this vote passes during a game, the player leaves and the room settles their seat and obligations. This vote applies only to this room.</p><button type="button" class="cta-red room-vote-confirm" data-votekick-action="start"><span class="cta-text cta-text-sm">START VOTE KICK</span></button></section>`;
  };

  const renderCurrentVote = () => {
    const details = voteDisplay(vote, now() + serverOffset);
    const resultCopy = voteResultCopy(details.status, details.displayStatus);
    const previousStatus = lastStatus;
    lastStatus = details.status;
    container.innerHTML = votePanelMarkup({
      vote,
      details: { ...details, targetName: targetName() },
      canVote: details.isActive && !pendingChoice,
      resultCopy,
      previousStatus,
    });
    if (details.isActive) timer = schedule(render, 1000);
  };

  const render = () => {
    clearTimer();
    if (!container) return;
    if (!vote?.voteId && !vote?.confirmTargetId) return renderFeedback();
    container.hidden = false;
    if (vote.confirmTargetId) return renderConfirmation();
    renderCurrentVote();
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

  const onChoiceClick = event => {
    const choiceButton = event.target.closest?.("[data-votekick-choice]");
    if (!canSubmitVoteChoice(choiceButton, pendingChoice, vote)) return false;
    pendingChoice = choiceButton.dataset.votekickChoice;
    render();
    emitVote("room-votekick-cast", {
      voteId: vote.voteId,
      choice: pendingChoice,
      requestId: requestId(createRequestId),
    }, response => { if (response?.success !== false) pendingChoice = choiceButton.dataset.votekickChoice; });
    return true;
  };

  const onActionClick = event => {
    const action = event.target.closest?.("[data-votekick-action]")?.dataset.votekickAction;
    if (action === "cancel") {
      vote = null;
      feedback = "";
      render();
      return;
    }
    if (action === "start" && vote?.confirmTargetId) {
      const targetPlayerId = vote.confirmTargetId;
      vote = null;
      render();
      emitVote("room-votekick-start", { targetPlayerId, requestId: requestId(createRequestId) });
    }
  };

  const onClick = event => {
    if (!onChoiceClick(event)) onActionClick(event);
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
