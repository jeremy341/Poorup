const CLOSED_LINGER_MS = 8000;
const FEEDBACK_LINGER_MS = 6000;

// Server rejection codes become plain sentences. Sentences the server already
// wrote (anything with a space) are shown untouched.
const REJECTION_COPY = Object.freeze({
  "already-voted": "You already voted on this one.",
  "ineligible-voter": "You can't vote on this one.",
  "vote-closed": "This vote has already closed.",
  "vote-expired": "This vote ran out of time.",
  "stale-vote": "That vote didn't go through. Try again.",
  "invalid-time": "That vote didn't go through. Try again.",
  "invalid-choice": "That vote didn't go through. Try again.",
  "replayed-request": "That vote didn't go through. Try again.",
});

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

export function voteRejectionCopy(error) {
  const text = String(error ?? "").trim();
  if (!text) return "The room vote could not be updated.";
  if (Object.prototype.hasOwnProperty.call(REJECTION_COPY, text)) return REJECTION_COPY[text];
  return text;
}

function voteDisplay(vote, currentTime) {
  const status = String(vote.status || "active");
  const seconds = Math.max(0, Math.ceil((Number(vote.expiresAt) - currentTime) / 1000));
  const isOpen = status === "open" || status === "active";
  const isActive = isOpen && seconds > 0;
  const displayStatus = isOpen && seconds === 0 ? "expired" : status;
  return { status, seconds, isActive, displayStatus };
}

function voteResultCopy(status, displayStatus, summary = "") {
  if (status === "closed") return String(summary || "").trim() || "Vote closed.";
  if (status === "passed") return "Vote passed. The room is settling this seat.";
  if (status === "failed" || displayStatus === "expired") return "Vote closed without removing the player.";
  return "If passed, removes this player and settles their assets and debts.";
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

function votePanelMarkup({ vote, details, view, resultCopy, previousStatus }) {
  const statusLabel = details.isActive ? "OPEN" : escapeText(details.displayStatus.toUpperCase());
  const expiry = details.isActive
    ? `<span class="room-vote-expiry" data-votekick-expiry aria-label="${details.seconds} seconds remaining">${details.seconds}s</span>`
    : `<button type="button" class="btn-dark" data-votekick-action="dismiss"><span class="t-label f11">DISMISS</span></button>`;
  const disabled = view.buttonsDisabled ? "disabled" : "";
  const actions = details.isActive && !view.isTarget
    ? `<div class="room-vote-actions"><button type="button" class="cta-red" data-votekick-choice="yes" ${disabled}><span class="cta-text cta-text-sm">VOTE YES</span></button><button type="button" class="btn-dark" data-votekick-choice="no" ${disabled}><span class="t-label f11">VOTE NO</span></button></div>`
    : "";
  const eligibleCount = voteCount(vote.eligibleCount);
  return `<section class="room-vote-panel panel noise" aria-labelledby="room-vote-title"><div class="room-vote-head"><div><span class="t-micro g400">ROOM VOTE · <span data-votekick-label>${statusLabel}</span></span><h2 class="t-section g100" id="room-vote-title">${escapeText(details.targetName)}</h2></div>${expiry}</div><div class="room-vote-counts"><div><span class="t-micro ink-3">YES</span><strong data-votekick-yes>${voteCount(vote.yesCount)}</strong></div><div><span class="t-micro ink-3">NO</span><strong data-votekick-no>${voteCount(vote.noCount)}</strong></div><div><span class="t-micro ink-3">NEEDED</span><strong data-votekick-needed>${voteCount(vote.requiredYes)}</strong></div></div><div class="room-vote-progress" data-votekick-progress role="progressbar" aria-label="Yes votes" aria-valuemin="0" aria-valuemax="${eligibleCount}" aria-valuenow="${voteCount(vote.yesCount)}"><span style="width:${voteProgress(vote)}%"></span></div><p class="t-body ink-2 room-vote-consequence" data-votekick-consequence>${escapeText(resultCopy)}</p><p class="t-body ink-2" data-votekick-note tabindex="-1">${escapeText(view.note)}</p>${actions}${voteAnnouncement(previousStatus, details.displayStatus, resultCopy)}</section>`;
}

function canSubmitVoteChoice(button, pendingChoice, vote) {
  const pendingHere = Boolean(pendingChoice) && pendingChoice.voteId === vote?.voteId;
  return [Boolean(button), !button?.disabled, !pendingHere, Boolean(vote?.voteId)].every(Boolean);
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
  let lingerTimer = null;
  let feedbackTimer = null;
  let pendingChoice = null;
  let lastStatus = "";
  let feedback = "";
  let renderedKey = "";
  let dismissedVoteId = "";
  // Per-vote local memory: the public snapshot never says who voted, so the
  // panel remembers this player's own ballot (and any ineligible rejection).
  const myBallots = new Map();
  const ineligibleVotes = new Set();

  const clearTimer = () => {
    if (timer !== null) cancel(timer);
    timer = null;
  };
  const clearLinger = () => {
    if (lingerTimer !== null) cancel(lingerTimer);
    lingerTimer = null;
  };
  const clearFeedbackTimer = () => {
    if (feedbackTimer !== null) cancel(feedbackTimer);
    feedbackTimer = null;
  };

  const findPlayer = id => players.find(player => String(player.serverId || player.id) === String(id));
  const pendingHere = () => Boolean(pendingChoice) && pendingChoice.voteId === vote?.voteId;
  const targetName = () => findPlayer(vote?.targetPlayerId)?.name || "PLAYER";
  const localPlayerId = () => players[0]?.serverId || players[0]?.id;

  const showFeedback = text => {
    feedback = text;
    clearFeedbackTimer();
    feedbackTimer = schedule(() => {
      feedbackTimer = null;
      feedback = "";
      render();
    }, FEEDBACK_LINGER_MS);
  };

  const clearFeedback = () => {
    feedback = "";
    clearFeedbackTimer();
  };

  const renderFeedback = () => {
    const key = `feedback:${feedback}`;
    if (renderedKey === key) return;
    renderedKey = key;
    container.hidden = !feedback;
    container.innerHTML = feedback ? `<p class="room-vote-panel panel noise t-body" role="status" aria-live="polite">${escapeText(feedback)}</p>` : "";
  };

  const renderConfirmation = () => {
    renderedKey = "";
    const target = findPlayer(vote.confirmTargetId);
    const targetLabel = target?.name || "this player";
    container.innerHTML = `<section class="room-vote-panel panel noise" aria-labelledby="room-vote-title"><div class="room-vote-head"><div><span class="t-micro g400">ROOM VOTE · CONFIRM</span><h2 class="t-section g100" id="room-vote-title">Remove ${escapeText(targetLabel)}?</h2></div><button type="button" class="btn-dark" data-votekick-action="cancel"><span class="t-label f11">CANCEL</span></button></div><p class="t-body ink-2">If passed, this player leaves this room. Their assets and debts are settled.</p><button type="button" class="cta-red room-vote-confirm" data-votekick-action="start"><span class="cta-text cta-text-sm">START THE VOTE</span></button></section>`;
  };

  const voteView = details => {
    const voteId = vote.voteId;
    const isTarget = Boolean(localPlayerId()) && String(localPlayerId()) === String(vote.targetPlayerId);
    const myChoice = myBallots.get(voteId);
    const ineligible = ineligibleVotes.has(voteId);
    const buttonsDisabled = !details.isActive || pendingHere() || Boolean(myChoice) || ineligible;
    let note = "";
    if (details.isActive) {
      if (isTarget) note = "This vote is about you, so you can't vote on it.";
      else if (pendingHere()) note = "Sending your vote…";
      else if (myChoice === "yes" || myChoice === "no") note = `You voted ${myChoice.toUpperCase()}.`;
      else if (myChoice) note = "You already voted on this one.";
      else if (ineligible) note = "You can't vote on this one.";
    }
    if (feedback) note = feedback;
    return { isTarget, buttonsDisabled, note };
  };

  const patchCurrentVote = (details, view, resultCopy, previousStatus) => {
    const set = (selector, text) => {
      const node = container.querySelector(selector);
      if (node && node.textContent !== String(text)) node.textContent = String(text);
    };
    const expiry = container.querySelector("[data-votekick-expiry]");
    if (expiry) {
      const text = `${details.seconds}s`;
      if (expiry.textContent !== text) expiry.textContent = text;
      expiry.setAttribute?.("aria-label", `${details.seconds} seconds remaining`);
    }
    set("[data-votekick-yes]", voteCount(vote.yesCount));
    set("[data-votekick-no]", voteCount(vote.noCount));
    set("[data-votekick-needed]", voteCount(vote.requiredYes));
    set("[data-votekick-consequence]", resultCopy);
    set("[data-votekick-note]", view.note);
    const progress = container.querySelector("[data-votekick-progress]");
    progress?.setAttribute?.("aria-valuenow", String(voteCount(vote.yesCount)));
    const bar = progress?.querySelector?.("span");
    if (bar?.style) bar.style.width = `${voteProgress(vote)}%`;
    const announcer = container.querySelector("[data-votekick-status]");
    if (announcer && previousStatus !== details.displayStatus) {
      announcer.textContent = resultCopy;
      announcer.setAttribute?.("aria-live", "polite");
    }
    const buttons = container.querySelectorAll?.("[data-votekick-choice]") || [];
    buttons.forEach(button => {
      if (button.disabled === view.buttonsDisabled) return;
      const hadFocus = typeof document !== "undefined" && document.activeElement === button;
      button.disabled = view.buttonsDisabled;
      if (hadFocus) container.querySelector("[data-votekick-note]")?.focus?.();
    });
  };

  const scheduleClose = details => {
    if (details.isActive || lingerTimer !== null) return;
    const closingId = vote.voteId;
    lingerTimer = schedule(() => {
      lingerTimer = null;
      dismissedVoteId = closingId;
      render();
    }, CLOSED_LINGER_MS);
  };

  const renderCurrentVote = () => {
    const details = voteDisplay(vote, now() + serverOffset);
    const resultCopy = voteResultCopy(details.status, details.displayStatus, vote.summary);
    const previousStatus = lastStatus;
    lastStatus = details.displayStatus;
    const view = voteView(details);
    const key = `${vote.voteId}|${details.isActive}|${details.displayStatus}|${view.isTarget}`;
    const canPatch = typeof container.querySelector === "function" && key === renderedKey;
    if (canPatch) {
      patchCurrentVote(details, view, resultCopy, previousStatus);
    } else {
      renderedKey = key;
      container.innerHTML = votePanelMarkup({
        vote,
        details: { ...details, targetName: targetName() },
        view,
        resultCopy,
        previousStatus,
      });
    }
    if (details.isActive) timer = schedule(render, 1000);
    else scheduleClose(details);
  };

  const render = () => {
    clearTimer();
    if (!container) return;
    if (!vote?.voteId && !vote?.confirmTargetId) return renderFeedback();
    if (vote.voteId && vote.voteId === dismissedVoteId) {
      return renderFeedback();
    }
    container.hidden = false;
    if (vote.confirmTargetId) return renderConfirmation();
    renderCurrentVote();
  };

  const emitVote = (eventName, payload, onDone) => {
    emit(eventName, payload, response => {
      if (response?.success === false) {
        showFeedback(voteRejectionCopy(response.error));
      }
      if (typeof onDone === "function") onDone(response);
      if (response?.success === false) render();
    });
  };

  const onChoiceClick = event => {
    const choiceButton = event.target.closest?.("[data-votekick-choice]");
    if (!canSubmitVoteChoice(choiceButton, pendingChoice, vote)) return false;
    const voteId = vote.voteId;
    const choice = choiceButton.dataset.votekickChoice;
    pendingChoice = { voteId, choice };
    clearFeedback();
    render();
    emitVote("room-votekick-cast", {
      voteId,
      choice,
      requestId: requestId(createRequestId),
    }, response => {
      if (pendingChoice?.voteId === voteId) pendingChoice = null;
      if (response?.success !== false) {
        myBallots.set(voteId, choice);
        render();
        return;
      }
      if (response.error === "already-voted") myBallots.set(voteId, "voted");
      if (response.error === "ineligible-voter") ineligibleVotes.add(voteId);
    });
    return true;
  };

  const onActionClick = event => {
    const action = event.target.closest?.("[data-votekick-action]")?.dataset.votekickAction;
    if (action === "cancel") {
      vote = null;
      clearFeedback();
      render();
      return;
    }
    if (action === "dismiss" && vote?.voteId) {
      dismissedVoteId = vote.voteId;
      clearLinger();
      render();
      return;
    }
    if (action === "start" && vote?.confirmTargetId) {
      const targetPlayerId = vote.confirmTargetId;
      vote = null;
      render();
      // Starting a vote casts the starter's own YES on the server.
      emitVote("room-votekick-start", { targetPlayerId, requestId: requestId(createRequestId) }, response => {
        if (response?.success !== false && response?.vote?.voteId) myBallots.set(response.vote.voteId, "yes");
      });
    }
  };

  const onClick = event => {
    if (!onChoiceClick(event)) onActionClick(event);
  };

  container?.addEventListener("click", onClick);
  return {
    requestStart(targetPlayerId, currentPlayers = players) {
      players = currentPlayers;
      clearFeedback();
      vote = { confirmTargetId: targetPlayerId };
      render();
    },
    update(nextVote, nextPlayers = players, serverTime) {
      const previousId = vote?.voteId || "";
      vote = nextVote || null;
      players = Array.isArray(nextPlayers) ? nextPlayers : [];
      if (vote?.voteId && vote.voteId !== previousId) {
        // A new vote starts clean: no inherited pending choice or rejection.
        pendingChoice = null;
        clearFeedback();
        clearLinger();
        lastStatus = "";
      }
      if (Number.isFinite(Number(serverTime)) && Number(serverTime) > 0) serverOffset = Number(serverTime) - now();
      if (!vote) {
        pendingChoice = null;
        clearLinger();
      }
      render();
    },
    destroy() {
      clearTimer();
      clearLinger();
      clearFeedbackTimer();
      container?.removeEventListener("click", onClick);
      if (container) { container.innerHTML = ""; container.hidden = true; }
      vote = null;
      players = [];
      pendingChoice = null;
      feedback = "";
      myBallots.clear();
      ineligibleVotes.clear();
    },
  };
}
