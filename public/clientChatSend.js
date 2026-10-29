// Chat composer send flow. The draft stays in the input until the server
// acknowledges it, so a rejected send (cooldown, paused room chat, lost
// connection) never costs the player their text.
function chatDraft(input) {
  return input ? String(input.value || '').trim() : '';
}

// The draft is cleared only when the server accepted the message and the composer still holds it.
function clearAcknowledgedDraft(input, text, response) {
  if (response?.success === false) return;
  if (chatDraft(input) === text) input.value = '';
}

export function createChatSender({ getInput, canSend = () => true, send, schedule = setTimeout, cancel = clearTimeout, releaseMs = 8000 }) {
  let pending = false;
  return function onChatFormSubmit(event) {
    event?.preventDefault?.();
    const input = getInput();
    const text = chatDraft(input);
    if (!input || pending) return false;
    if (!text || !canSend()) return false;
    pending = true;
    // An ack that never arrives must not lock the composer.
    const release = schedule(() => { pending = false; }, releaseMs);
    send(text, response => {
      cancel(release);
      pending = false;
      clearAcknowledgedDraft(input, text, response);
    });
    return true;
  };
}
