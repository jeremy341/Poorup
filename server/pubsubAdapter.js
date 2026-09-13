// Small provider-neutral pub/sub seam. The default adapter is process-local
// and deterministic; Redis or another broker can replace it before horizontal
// mode is enabled without changing room or Socket.IO contracts.
const MAX_TOPIC_LENGTH = 120;
const MAX_PAYLOAD_BYTES = 100_000;

function safeTopic(topic) {
  if (typeof topic !== 'string') return '';
  const value = topic.trim().slice(0, MAX_TOPIC_LENGTH);
  return value && /^[A-Za-z0-9:._/-]+$/.test(value) ? value : '';
}

function safePayload(payload) {
  try {
    const serialized = JSON.stringify(payload ?? null);
    if (serialized.length > MAX_PAYLOAD_BYTES) return null;
    return JSON.parse(serialized);
  } catch {
    return null;
  }
}

export function createPubSubAdapter() {
  const topics = new Map();
  let closed = false;

  function subscribe(topic, handler) {
    const key = safeTopic(topic);
    if (closed) return () => {};
    if (!key) return () => {};
    if (typeof handler !== 'function') return () => {};
    const listeners = topics.get(key) || new Set();
    listeners.add(handler);
    topics.set(key, listeners);
    return () => {
      listeners.delete(handler);
      if (!listeners.size) topics.delete(key);
    };
  }

  function publish(topic, payload) {
    const key = safeTopic(topic);
    const copy = safePayload(payload);
    if (closed || !key || copy === null) return { success: false, delivered: 0, error: 'Topic or payload is invalid.' };
    const listeners = topics.get(key);
    if (!listeners?.size) return { success: true, delivered: 0 };
    let delivered = 0;
    [...listeners].forEach(handler => {
      try { handler(copy); delivered += 1; } catch { /* subscriber isolation */ }
    });
    return { success: true, delivered };
  }

  function close() {
    closed = true;
    topics.clear();
  }

  return { publish, subscribe, close, topicCount: () => topics.size };
}

export { MAX_TOPIC_LENGTH, MAX_PAYLOAD_BYTES, safeTopic, safePayload };
