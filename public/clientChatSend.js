// Chat composer send flow. The draft stays in the input until the server
// acknowledges it, so a rejected send (cooldown, paused room chat, lost
// connection) never costs the player their text.
export function createChatSender({ getInput, canSend = () => true, send, schedule = setTimeout, cancel = clearTimeout, releaseMs = 8000 }) {
  let pending = false;
  return function onChatFormSubmit(event) {
    event?.preventDefault?.();
    const input = getInput();
    if (!input || pending) return false;
    const text = String(input.value || "").trim();
    if (!text || !canSend()) return false;
    pending = true;
    // An ack that never arrives must not lock the composer.
    const release = schedule(() => { pending = false; }, releaseMs);
    send(text, response => {
      cancel(release);
      pending = false;
      if (response?.success === false) return;
      if (String(input.value || "").trim() === text) input.value = "";
    });
    return true;
  };
}
