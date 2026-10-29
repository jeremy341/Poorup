// Small constants and value helpers shared by the account modules.

export const USERNAME_RE = /^[a-z0-9_]{3,16}$/;

export const num = (value) => Number(value) || 0;

// A hybrid is a loan only while its debt leg is active/due/settled; once it
// converts, the remaining live instrument is equity and must not inflate the
// player-loan leaderboard counters.
export const loanLikeContract = contract => contract?.kind === 'loan'
  || (contract?.kind === 'hybrid' && contract.status !== 'converted');

export const equityLikeContract = contract => contract?.kind === 'equity' || (contract?.kind === 'hybrid' && contract?.status === 'converted');

export const clampInt = (value, max) => Math.max(0, Math.min(max, Math.floor(Number(value) || 0)));

export const PENDING_PATROL_ACHIEVEMENT_LIMIT = 100;

export const nonNegative = (value) => Math.max(0, Number(value) || 0);

export const clippedList = (value, cap) => (Array.isArray(value) ? value.slice(0, cap) : []);
