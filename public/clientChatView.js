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
