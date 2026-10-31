// Games, wins, achievements and cross-game history for each computer persona. Kept apart from accounts, so these records never reach profiles or rankings.
import path from 'path';
import { fileURLToPath } from 'url';
import { loadJson, writeJson } from './storeIO.js';
import { BOT_PERSONAS } from './botPersonas.js';
import { resolveAuxiliaryStorePaths } from './serverStorePaths.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_FILE = path.join(__dirname, 'data', 'bot-personas.json');
const MAX_ACHIEVEMENTS = 60;
const MAX_HISTORY_ENTRIES = 64;

function emptyRecord() {
  return { gamesPlayed: 0, wins: 0, achievements: [], treasureCards: [], events: [] };
}

function sanitizeAchievement(entry) {
  if (!entry || typeof entry !== 'object' || typeof entry.achievementId !== 'string') return null;
  return {
    achievementId: entry.achievementId.slice(0, 40),
    title: String(entry.title || '').slice(0, 60),
    rarity: String(entry.rarity || '').slice(0, 20),
    body: String(entry.body || '').slice(0, 200),
  };
}

function sanitizeHistoryList(value) {
  const list = Array.isArray(value) ? value : [];
  return [...new Set(list.filter(item => typeof item === 'string' && item).map(item => item.slice(0, 160)))].slice(0, MAX_HISTORY_ENTRIES);
}

function sanitizeRecords(value) {
  const records = {};
  for (const persona of BOT_PERSONAS) {
    const entry = value && typeof value === 'object' ? value[persona.id] : null;
    const achievements = Array.isArray(entry?.achievements) ? entry.achievements.map(sanitizeAchievement).filter(Boolean) : [];
    records[persona.id] = {
      gamesPlayed: Math.max(0, Math.floor(Number(entry?.gamesPlayed) || 0)),
      wins: Math.max(0, Math.floor(Number(entry?.wins) || 0)),
      achievements: achievements.slice(0, MAX_ACHIEVEMENTS),
      treasureCards: sanitizeHistoryList(entry?.treasureCards),
      events: sanitizeHistoryList(entry?.events),
    };
  }
  return records;
}

// A null filePath keeps the records in memory only (used by tests).
export function createBotPersonaStore(filePath = DEFAULT_FILE) {
  const loaded = filePath ? loadJson(filePath) : { value: null };
  const records = sanitizeRecords(loaded.value);

  function persist() {
    if (filePath) writeJson(filePath, records);
  }

  return {
    statsFor(personaId) {
      const entry = records[personaId] || emptyRecord();
      return { gamesPlayed: entry.gamesPlayed, wins: entry.wins, achievements: entry.achievements.length };
    },

    achievementsFor(personaId) {
      return (records[personaId]?.achievements || []).map(entry => ({ ...entry }));
    },

    // What a table card shows for a computer seat: its counts and the unlocks it earned. Null for an unknown persona.
    profileFor(personaId) {
      if (!records[personaId]) return null;
      return { ...this.statsFor(personaId), unlocked: this.achievementsFor(personaId) };
    },

    // Treasure cards and headlines seen in earlier games, so rules that count across games can count for a persona too.
    historyFor(personaId) {
      const entry = records[personaId] || emptyRecord();
      return { treasureCards: [...entry.treasureCards], events: [...entry.events] };
    },

    recordGame(personaId, won) {
      if (!records[personaId]) return;
      records[personaId].gamesPlayed += 1;
      if (won) records[personaId].wins += 1;
      persist();
    },

    recordHistory(personaId, { treasureCards = [], events = [] } = {}) {
      const record = records[personaId];
      if (!record) return;
      const before = JSON.stringify([record.treasureCards, record.events]);
      record.treasureCards = sanitizeHistoryList([...record.treasureCards, ...treasureCards]);
      record.events = sanitizeHistoryList([...record.events, ...events]);
      if (JSON.stringify([record.treasureCards, record.events]) !== before) persist();
    },

    // Each achievement is kept once per persona, however many games unlock it.
    recordAchievement(personaId, achievement) {
      const record = records[personaId];
      const entry = sanitizeAchievement(achievement);
      if (!record || !entry || record.achievements.length >= MAX_ACHIEVEMENTS) return false;
      if (record.achievements.some(existing => existing.achievementId === entry.achievementId)) return false;
      record.achievements.push(entry);
      persist();
      return true;
    },
  };
}

// Stored under the configured data directory, so it is backed up with the other stores. Without one it falls back to server/data, as the other stores do.
export const botPersonaStore = createBotPersonaStore(resolveAuxiliaryStorePaths(process.env).botPersonas || DEFAULT_FILE);
