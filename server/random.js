// Shared cryptographic RNG helpers. Extracted so the game board, casino,
// global events, and market all draw from one auditable source of randomness.
import crypto from 'crypto';

export function randomInt(min, max) {
  return crypto.randomInt(min, max + 1);
}

export function randomFloat() {
  return crypto.randomInt(0, 1_000_000) / 1_000_000;
}
