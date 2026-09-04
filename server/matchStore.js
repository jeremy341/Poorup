import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { sanitizeParticipant } from './participantFields.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_FILE = path.join(__dirname, 'data', 'matches.json');
const MAX_MATCHES = 500;

function safeArray(value, limit) {
  return Array.isArray(value) ? value.slice(0, limit) : [];
}

function sanitizeMatch(record = {}) {
  return {
    matchId: typeof record.matchId === 'string' ? record.matchId.slice(0, 80) : null,
    completedAt: typeof record.completedAt === 'string' ? record.completedAt : new Date().toISOString(),
    durationSeconds: Math.max(0, Number(record.durationSeconds) || 0),
    roundCount: Math.max(0, Number(record.roundCount) || 0),
    roomVisibility: record.roomVisibility === 'private' ? 'private' : 'public',
    participants: safeArray(record.participants, 8).map(sanitizeParticipant),
    globalEvents: safeArray(record.globalEvents, 20).filter((item) => typeof item === 'string').map((item) => item.slice(0, 100)),
    eventCombinations: safeArray(record.eventCombinations, 10).filter((item) => typeof item === 'string').map((item) => item.slice(0, 100)),
    tradesCompleted: Math.max(0, Number(record.tradesCompleted) || 0),
    auctionsCompleted: Math.max(0, Number(record.auctionsCompleted) || 0),
    casino: safeArray(record.casino, 8).map(entry => ({ accountId: typeof entry?.accountId === 'string' ? entry.accountId : null, bets: Math.max(0, Number(entry?.bets) || 0), net: Number(entry?.net) || 0 })),
    market: safeArray(record.market, 8).map(entry => ({ accountId: typeof entry?.accountId === 'string' ? entry.accountId : null, positions: entry?.positions && typeof entry.positions === 'object' ? entry.positions : {} })),
    playerContracts: safeArray(record.playerContracts, 20).map(contract => ({
      id: typeof contract?.id === 'string' ? contract.id.slice(0, 100) : null,
      kind: contract?.kind === 'equity' ? 'equity' : 'loan',
      fromAccountId: typeof contract?.fromAccountId === 'string' ? contract.fromAccountId : null,
      toAccountId: typeof contract?.toAccountId === 'string' ? contract.toAccountId : null,
      fromPlayerId: typeof contract?.fromPlayerId === 'string' ? contract.fromPlayerId : null,
      toPlayerId: typeof contract?.toPlayerId === 'string' ? contract.toPlayerId : null,
      amount: Math.max(0, Number(contract?.amount) || 0),
      status: typeof contract?.status === 'string' ? contract.status.slice(0, 20) : 'unknown',
      premiumRate: Math.max(0, Number(contract?.premiumRate) || 0),
      equityShare: Math.max(0, Number(contract?.equityShare) || 0),
      collateralTileIndex: Number.isInteger(Number(contract?.collateralTileIndex)) ? Number(contract.collateralTileIndex) : null
    })),
  };
}

export class MatchStore {
  constructor(filePath = DEFAULT_FILE) {
    this.filePath = filePath;
    this.matches = new Map();
    this.load();
  }

  load() {
    try {
      const raw = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
      const records = Array.isArray(raw) ? raw : [];
      records.forEach((record) => {
        const match = sanitizeMatch(record);
        if (match.matchId) this.matches.set(match.matchId, match);
      });
    } catch {
      // A missing match file starts an empty ledger.
    }
  }

  persist() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const records = [...this.matches.values()]
      .sort((a, b) => String(b.completedAt).localeCompare(String(a.completedAt)))
      .slice(0, MAX_MATCHES);
    fs.writeFileSync(this.filePath, `${JSON.stringify(records, null, 2)}\n`, 'utf8');
  }

  record(record) {
    const match = sanitizeMatch(record);
    if (!match.matchId) return { created: false, match: null };
    const existing = this.matches.get(match.matchId);
    if (existing) return { created: false, match: existing };
    this.matches.set(match.matchId, match);
    this.persist();
    return { created: true, match };
  }

  get(matchId) {
    return this.matches.get(matchId) || null;
  }

  listForAccount(accountId, limit = 50) {
    if (!accountId) return [];
    return [...this.matches.values()]
      .filter((match) => match.participants.some((participant) => participant.accountId === accountId))
      .sort((a, b) => String(b.completedAt).localeCompare(String(a.completedAt)))
      .slice(0, Math.max(1, Math.min(100, Number(limit) || 50)));
  }
}
