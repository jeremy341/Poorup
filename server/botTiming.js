export const BOT_TURN_DELAY_MS = 300;
export const BOT_AUCTION_DELAY_MS = 450;

export function scheduleBotTimer(setTimeoutFn, callback, kind = 'turn') {
  const delay = kind === 'auction' ? BOT_AUCTION_DELAY_MS : BOT_TURN_DELAY_MS;
  return setTimeoutFn(callback, delay);
}
