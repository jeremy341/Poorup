const roomCodeAlphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

export function visualRoomCode(prefix, seed, profileId) {
  if (!/^[A-Z0-9]{1,3}$/.test(prefix)) throw new Error('Room-code prefix must contain one to three uppercase letters or digits.');
  if (!seed || !profileId) throw new Error('Room-code seed and viewport profile are required.');

  const source = `${seed}:${profileId}:${prefix}`;
  let state = 2_166_136_261;
  for (const character of source) state = Math.imul(state ^ character.charCodeAt(0), 16_777_619) >>> 0;

  let suffix = '';
  for (let index = 0; index < 6 - prefix.length; index += 1) {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    suffix += roomCodeAlphabet[state % roomCodeAlphabet.length];
  }
  return `${prefix}${suffix}`;
}
