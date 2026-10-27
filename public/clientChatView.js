export function getChatRenderPlan({
  isFirstRender = false,
  isNearBottom = false,
  roomChanged = false,
  hasNewMessages = false,
} = {}) {
  const resetView = isFirstRender || roomChanged;
  const shouldFollow = isNearBottom && hasNewMessages;
  return {
    updateContent: resetView || shouldFollow,
    followBottom: resetView || shouldFollow,
    showNewMessages: !resetView && !isNearBottom && hasNewMessages,
  };
}

// An empty chat has no tail: normalise undefined to null so it matches the null the renderer stores,
// otherwise every render of an empty chat looks like a new message.
export function hasUnrenderedMessages(messages, renderedCount, renderedTail) {
  return messages.length !== renderedCount || (messages.at(-1) ?? null) !== renderedTail;
}
