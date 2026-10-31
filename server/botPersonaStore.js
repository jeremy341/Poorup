// Games and wins for each computer persona. Kept apart from accounts, so these records never reach profiles or rankings.
import path from 'path';
import { fileURLToPath } from 'url';
import { loadJson, writeJson } from './storeIO.js';
import { BOT_PERSONAS } from './botPersonas.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_FILE = path.join(__dirname, 'data', 'bot-personas.json');

function emptyRecord() {
  return { gamesPlayed: 0, wins: 0 };
}

function sanitizeRecords(value) {
  const known = new Set(BOT_PERSONAS.map(persona => persona.id));
  const records = {};
  for (const id of known) {
    const entry = value && typeof value === 'object' ? value[id] : null;
    records[id] = {
      gamesPlayed: Math.max(0, Math.floor(Number(entry?.gamesPlayed) || 0)),
      wins: Math.max(0, Math.floor(Number(entry?.wins) || 0)),
    };
  }
  return records;
}

// A null filePath keeps the records in memory only (used by tests).
export function createBotPersonaStore(filePath = DEFAULT_FILE) {
  const loaded = filePath ? loadJson(filePath) : { value: null };
  let records = sanitizeRecords(loaded.value);

  function persist() {
    if (filePath) writeJson(filePath, records);
  }

  return {
    statsFor(personaId) {
      const entry = records[personaId] || emptyRecord();
      return { gamesPlayed: entry.gamesPlayed, wins: entry.wins };
    },

    recordGame(personaId, won) {
      if (!records[personaId]) return;
      records[personaId].gamesPlayed += 1;
      if (won) records[personaId].wins += 1;
      persist();
    },
  };
}

export const botPersonaStore = createBotPersonaStore();
