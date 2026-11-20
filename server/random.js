// Shared cryptographic RNG helpers, so the game board, casino,
// global events, and market all draw from one auditable source of randomness.
import crypto from 'crypto';

export function randomInt(min, max) {
  return crypto.randomInt(min, max + 1);
}

// A float in [0, 1) with six decimal places of resolution, plenty for drift and probability rolls.
export function randomFloat() {
  return crypto.randomInt(0, 1_000_000) / 1_000_000;
}
