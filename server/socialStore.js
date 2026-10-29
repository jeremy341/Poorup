import crypto from 'crypto';
import { fileURLToPath } from 'url';
import path from 'path';
import { loadJson, writeJson } from './storeIO.js';
import { cleanDisplayText, sliceCodePoints } from './nicknamePolicy.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_FILE = path.join(__dirname, 'data', 'social.json');

function id(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function clipText(value, maxLength) {
  return sliceCodePoints(cleanDisplayText(String(value || '')), maxLength);
}

function boundedIdentifier(value, max = 120) {
  if (typeof value !== 'string') return '';
  const normalized = value.trim();
  return normalized && normalized.length <= max ? normalized : '';
}

function metadataOrEmpty(metadata) {
  return metadata && typeof metadata === 'object' ? metadata : {};
}

function cleanNotification(notification = {}) {
  return {
    id: notification.id,
    kind: notification.kind,
    title: clipText(notification.title, 120),
    body: clipText(notification.body, 250),
    createdAt: notification.createdAt,
    readAt: notification.readAt || null,
    metadata: metadataOrEmpty(notification.metadata)
  };
}

function arrayOrEmpty(value) {
  return Array.isArray(value) ? value : [];
}

const MAX_SOCIAL_RECORDS = 10_000;
// Blocks, friendships and reports are never truncated globally (that silently
// unblocked people and dropped evidence). Each account is capped instead and
// the mutation is refused at the cap.
const MAX_BLOCKS_PER_ACCOUNT = 500;
const MAX_FRIENDSHIPS_PER_ACCOUNT = 1_000;
const MAX_PENDING_INBOUND_REQUESTS_PER_ACCOUNT = 100;
// Declined (closed) requests are history, not live evidence. They are bounded
// per account and the most recent rows are kept so a decline cooldown still
// applies after a restart.
const MAX_CLOSED_FRIENDSHIPS_PER_ACCOUNT = 50;
const MAX_OPEN_REPORTS_PER_REPORTER = 50;
// Closed report history is bounded by age and per-reporter count; open reports
// are never deleted by load/housekeeping because they are live evidence.
const REPORT_RETENTION_MS = 180 * 24 * 60 * 60 * 1000;
const MAX_ARCHIVED_REPORTS_PER_REPORTER = 200;
// How long a sender waits before asking the same player again after a cancel
// or a decline. The cancel cooldown is kept in memory, bounded below.
const CANCELLED_REQUEST_COOLDOWN_MS = 60 * 60 * 1000;
const DECLINED_REQUEST_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const MAX_COOLDOWN_ENTRIES = 10_000;
const COOLDOWN_ERROR = 'Please wait before sending that friend request again.';

function objectArray(value, limit = Infinity) {
  return arrayOrEmpty(value)
    .filter(entry => entry && typeof entry === 'object' && !Array.isArray(entry))
    .slice(0, limit);
}

// True when (first, second) is the unordered pair (x, y). Encapsulates the
// mutual-pair test shared by the friendship and invite removals in blockPlayer.
function matchesPair(first, second, x, y) {
  if (first === x && second === y) return true;
  return first === y && second === x;
}

function involvesAccount(entry, accountId) {
  return entry.requesterId === accountId || entry.addresseeId === accountId;
}

function friendIdOther(entry, accountId) {
  return entry.requesterId === accountId ? entry.addresseeId : entry.requesterId;
}

function isIncomingRequest(entry, accountId) {
  return entry.status === 'requested' && entry.addresseeId === accountId;
}

function isOutgoingRequest(entry, accountId) {
  return entry.status === 'requested' && entry.requesterId === accountId;
}

function isPendingInviteFor(invite, accountId) {
  return invite.recipientId === accountId && invite.status === 'pending';
}

function notificationsFor(map, accountId) {
  return map.get(accountId) || [];
}

// The shared self/empty-pair guard. Returns the caller's message on the first
// failed condition (in the original short-circuit order) or null to proceed.
function invalidPairError(firstId, secondId, message) {
  if (!firstId) return message;
  if (!secondId) return message;
  if (firstId === secondId) return message;
  return null;
}

// A prior friendship blocks a new request only while accepted or pending; a
// declined record is cleared and re-requested below.
function existingFriendshipError(existing) {
  if (existing?.status === 'accepted') return 'You are already friends.';
  if (existing?.status === 'requested') return 'A friend request is already pending.';
  return null;
}

function findPendingInvite(invites, roomId, roomCode, senderId, recipientId) {
  return invites.find(invite => ((roomId && invite.roomId === roomId) || (!roomId && !invite.roomId && invite.roomCode === roomCode))
    && invite.senderId === senderId && invite.recipientId === recipientId && invite.status === 'pending');
}

const DELETED_PLAYER_LABEL = 'A deleted player';

// A notification that names the deleted account by id, or belongs to one of
// its removed invites, is dropped from the other player's list.
function referencesDeletedAccount(notification, accountId, removedInviteIds) {
  const metadata = notification.metadata || {};
  return metadata.accountId === accountId || metadata.playerId === accountId || removedInviteIds.has(metadata.inviteId);
}

// Any whole-word copy of the display name left in a notification's text is
// replaced. Matching is bounded to name tokens so an unrelated word that merely
// contains the name as a substring is never corrupted.
function redactDisplayName(text, displayName) {
  if (!displayName || typeof text !== 'string') return text;
  const escaped = displayName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return text.replace(new RegExp(`(^|[^\\p{L}\\p{N}_])${escaped}(?=[^\\p{L}\\p{N}_]|$)`, 'giu'), `$1${DELETED_PLAYER_LABEL}`);
}

function scrubNotificationList(list, accountId, removedInviteIds, displayName) {
  return list
    .filter(item => !referencesDeletedAccount(item, accountId, removedInviteIds))
    .map(item => ({ ...item, title: redactDisplayName(item.title, displayName), body: redactDisplayName(item.body, displayName) }));
}

function isOpenReport(report, accountId, otherId) {
  if (report.reporterId !== accountId) return false;
  if (report.reportedId !== otherId) return false;
  return report.status === 'open';
}

function hasOpenReport(reports, accountId, otherId) {
  return reports.some(report => isOpenReport(report, accountId, otherId));
}

// Load-time normalization: persisted rows may predate validation. Friendship
// rows are unordered pairs, so the key is canonical even though the stored
// direction (who asked whom) is preserved.
function friendshipKey(entry) {
  return entry.requesterId < entry.addresseeId
    ? `${entry.requesterId}\u0000${entry.addresseeId}`
    : `${entry.addresseeId}\u0000${entry.requesterId}`;
}

function adjustFriendshipCounts(accountCounts, inboundCounts, entry, delta) {
  if (entry.status === 'accepted') {
    for (const accountId of [entry.requesterId, entry.addresseeId]) {
      accountCounts.set(accountId, (accountCounts.get(accountId) || 0) + delta);
    }
    return;
  }
  if (entry.status !== 'requested') return;
  accountCounts.set(entry.requesterId, (accountCounts.get(entry.requesterId) || 0) + delta);
  inboundCounts.set(entry.addresseeId, (inboundCounts.get(entry.addresseeId) || 0) + delta);
}

function recordTimestamp(entry) {
  const value = Date.parse(entry.updatedAt || entry.createdAt || '');
  return Number.isFinite(value) ? value : 0;
}

// Closed rows (declined or unknown status) are history: they are bounded per
// account and the most recent ones are kept, so a decline cooldown is not lost
// by the bound.
function boundClosedFriendships(friendships) {
  const closedIndexes = [];
  friendships.forEach((entry, index) => {
    if (entry.status !== 'accepted' && entry.status !== 'requested') closedIndexes.push(index);
  });
  if (!closedIndexes.length) return friendships;
  const counts = new Map();
  const kept = new Set();
  const byRecency = closedIndexes.slice().sort((a, b) => recordTimestamp(friendships[b]) - recordTimestamp(friendships[a]));
  for (const index of byRecency) {
    const entry = friendships[index];
    if ((counts.get(entry.requesterId) || 0) >= MAX_CLOSED_FRIENDSHIPS_PER_ACCOUNT) continue;
    if ((counts.get(entry.addresseeId) || 0) >= MAX_CLOSED_FRIENDSHIPS_PER_ACCOUNT) continue;
    counts.set(entry.requesterId, (counts.get(entry.requesterId) || 0) + 1);
    counts.set(entry.addresseeId, (counts.get(entry.addresseeId) || 0) + 1);
    kept.add(index);
  }
  const dropped = new Set(closedIndexes.filter(index => !kept.has(index)));
  return friendships.filter((entry, index) => !dropped.has(index));
}

// Higher rank wins when two persisted rows describe the same pair.
const FRIENDSHIP_STATUS_RANK = { accepted: 3, requested: 2, declined: 1 };

function normalizeFriendshipRow(entry) {
  const requesterId = boundedIdentifier(entry.requesterId);
  const addresseeId = boundedIdentifier(entry.addresseeId);
  if (!requesterId || !addresseeId || requesterId === addresseeId) return null;
  return { ...entry, requesterId, addresseeId };
}

function outranksFriendship(candidate, current) {
  return (FRIENDSHIP_STATUS_RANK[candidate.status] || 0) > (FRIENDSHIP_STATUS_RANK[current.status] || 0);
}

// Live rows are capped per account: accepted friendships against the friend
// budget, and requests against the requester's budget and the addressee's inbox.
function friendshipCapReached({ accountCounts, inboundCounts }, { status, requesterId, addresseeId }) {
  const friendCount = accountId => accountCounts.get(accountId) || 0;
  if (status === 'accepted') {
    return friendCount(requesterId) >= MAX_FRIENDSHIPS_PER_ACCOUNT || friendCount(addresseeId) >= MAX_FRIENDSHIPS_PER_ACCOUNT;
  }
  if (status === 'requested') {
    return friendCount(requesterId) >= MAX_FRIENDSHIPS_PER_ACCOUNT
      || (inboundCounts.get(addresseeId) || 0) >= MAX_PENDING_INBOUND_REQUESTS_PER_ACCOUNT;
  }
  return false;
}

function replaceFriendshipRow(state, index, normalized) {
  adjustFriendshipCounts(state.accountCounts, state.inboundCounts, state.result[index], -1);
  state.result[index] = normalized;
  adjustFriendshipCounts(state.accountCounts, state.inboundCounts, normalized, 1);
}

function admitFriendship(state, normalized) {
  const key = friendshipKey(normalized);
  const existingIndex = state.byPair.get(key);
  if (existingIndex !== undefined) {
    if (outranksFriendship(normalized, state.result[existingIndex])) replaceFriendshipRow(state, existingIndex, normalized);
    return;
  }
  if (friendshipCapReached(state, normalized)) return;
  state.byPair.set(key, state.result.length);
  state.result.push(normalized);
  adjustFriendshipCounts(state.accountCounts, state.inboundCounts, normalized, 1);
}

function normalizeFriendships(entries) {
  const state = { result: [], byPair: new Map(), accountCounts: new Map(), inboundCounts: new Map() };
  for (const entry of objectArray(entries)) {
    const normalized = normalizeFriendshipRow(entry);
    if (normalized) admitFriendship(state, normalized);
  }
  return boundClosedFriendships(state.result);
}

function normalizeBlocks(entries) {
  const result = [];
  const seen = new Set();
  const counts = new Map();
  for (const entry of objectArray(entries)) {
    const blockerId = boundedIdentifier(entry.blockerId);
    const blockedId = boundedIdentifier(entry.blockedId);
    if (!blockerId || !blockedId || blockerId === blockedId) continue;
    const key = `${blockerId}\u0000${blockedId}`;
    if (seen.has(key)) continue;
    if ((counts.get(blockerId) || 0) >= MAX_BLOCKS_PER_ACCOUNT) continue;
    seen.add(key);
    counts.set(blockerId, (counts.get(blockerId) || 0) + 1);
    result.push({ ...entry, blockerId, blockedId });
  }
  return result;
}

function normalizeReportRow(entry) {
  const reporterId = boundedIdentifier(entry.reporterId);
  const reportedId = boundedIdentifier(entry.reportedId);
  if (!reporterId || !reportedId || reporterId === reportedId) return null;
  return { ...entry, reporterId, reportedId };
}

// One open report per reporter/reported pair; the first row wins.
function admitOpenReport(openPairs, report) {
  const key = `${report.reporterId}\u0000${report.reportedId}`;
  if (openPairs.has(key)) return false;
  openPairs.add(key);
  return true;
}

// Closed reports are kept while young enough and within the per-reporter bound.
function admitArchivedReport(archivedCounts, report, now) {
  const createdAt = Date.parse(report.createdAt || '');
  if (Number.isFinite(createdAt) && now - createdAt > REPORT_RETENTION_MS) return false;
  const count = archivedCounts.get(report.reporterId) || 0;
  if (count >= MAX_ARCHIVED_REPORTS_PER_REPORTER) return false;
  archivedCounts.set(report.reporterId, count + 1);
  return true;
}

function normalizeReports(entries, now = Date.now()) {
  const result = [];
  const openPairs = new Set();
  const archivedCounts = new Map();
  for (const entry of objectArray(entries)) {
    const normalized = normalizeReportRow(entry);
    if (!normalized) continue;
    const admitted = normalized.status === 'open'
      ? admitOpenReport(openPairs, normalized)
      : admitArchivedReport(archivedCounts, normalized, now);
    if (admitted) result.push(normalized);
  }
  return result;
}

// Cooldown left by removing a request or a decline. An accepted friendship leaves none.
function remainingDeclineCooldown(declined) {
  const declinedAt = Date.parse(declined.updatedAt || '');
  return Number.isFinite(declinedAt)
    ? Math.max(0, DECLINED_REQUEST_COOLDOWN_MS - Math.max(0, Date.now() - declinedAt))
    : DECLINED_REQUEST_COOLDOWN_MS;
}

function startRequestedRemovalCooldown(store, existing, accountId) {
  if (existing.requesterId === accountId) {
    store.startRequestCooldown(existing.requesterId, existing.addresseeId);
    return;
  }
  store.startRequestCooldown(existing.requesterId, existing.addresseeId, Date.now(), DECLINED_REQUEST_COOLDOWN_MS);
}

function startDeclinedRemovalCooldown(store, existing) {
  const remaining = remainingDeclineCooldown(existing);
  if (remaining > 0) store.startRequestCooldown(existing.requesterId, existing.addresseeId, Date.now(), remaining);
}

function startRemovalCooldown(store, existing, accountId) {
  if (existing.status === 'requested') startRequestedRemovalCooldown(store, existing, accountId);
  else if (existing.status === 'declined') startDeclinedRemovalCooldown(store, existing);
}

export class SocialStore {
  constructor(filePath = DEFAULT_FILE) {
    this.filePath = filePath;
    this.friendships = [];
    this.blocks = [];
    this.invites = [];
    this.reports = [];
    this.notifications = new Map();
    this.requestCooldowns = new Map();
    this.load();
  }

  // Memory is the live copy and the file follows it. A mutation that cannot be
  // persisted is rolled back and rethrown, so an ack never reports success for
  // state the next restart would lose (mirrors AccountStore.commitMutation).
  snapshot() {
    return structuredClone({
      friendships: this.friendships,
      blocks: this.blocks,
      invites: this.invites,
      reports: this.reports,
      notifications: [...this.notifications],
      requestCooldowns: [...this.requestCooldowns]
    });
  }

  persistOrRestore(snapshot) {
    try {
      this.persist();
    } catch (error) {
      this.friendships = snapshot.friendships;
      this.blocks = snapshot.blocks;
      this.invites = snapshot.invites;
      this.reports = snapshot.reports;
      this.notifications.clear();
      snapshot.notifications.forEach(([owner, list]) => this.notifications.set(owner, list));
      this.requestCooldowns = new Map(snapshot.requestCooldowns);
      throw error;
    }
  }

  friendshipCount(accountId) {
    return this.friendships.filter(entry => (entry.status === 'accepted'
      ? involvesAccount(entry, accountId)
      : isOutgoingRequest(entry, accountId))).length;
  }

  // Incoming requests never spend the recipient's friendship budget, so they
  // are bounded separately.
  pendingInboundCount(accountId) {
    return this.friendships.filter(entry => isIncomingRequest(entry, accountId)).length;
  }

  requestCooldownError(fromId, toId, existing, now = Date.now()) {
    const key = `${fromId}>${toId}`;
    const until = this.requestCooldowns.get(key)?.until;
    if (until && until > now) return COOLDOWN_ERROR;
    if (until) this.requestCooldowns.delete(key);
    if (existing?.status === 'declined' && existing.requesterId === fromId) {
      const declinedAt = Date.parse(existing.updatedAt || '');
      if (Number.isFinite(declinedAt) && now - declinedAt < DECLINED_REQUEST_COOLDOWN_MS) return COOLDOWN_ERROR;
    }
    return null;
  }

  startRequestCooldown(fromId, toId, now = Date.now(), durationMs = CANCELLED_REQUEST_COOLDOWN_MS) {
    if (this.requestCooldowns.size >= MAX_COOLDOWN_ENTRIES) {
      for (const [key, entry] of this.requestCooldowns) if (entry.until <= now) this.requestCooldowns.delete(key);
      if (this.requestCooldowns.size >= MAX_COOLDOWN_ENTRIES) this.requestCooldowns.delete(this.requestCooldowns.keys().next().value);
    }
    this.requestCooldowns.set(`${fromId}>${toId}`, { fromId, toId, until: now + durationMs });
  }

  // Housekeeping is best-effort: an expired invite is only dropped from memory
  // once the prune is durable, otherwise the in-memory list is restored.
  pruneExpiredInvites(now = Date.now()) {
    const before = this.invites.length;
    const remaining = this.invites.filter(invite => {
      if (invite.status !== 'pending') return true;
      const expiresAt = Date.parse(invite.expiresAt || '');
      return Number.isFinite(expiresAt) && expiresAt > now;
    });
    if (remaining.length === before) return 0;
    const snapshot = this.snapshot();
    this.invites = remaining;
    try {
      this.persistOrRestore(snapshot);
    } catch {
      return 0;
    }
    return before - remaining.length;
  }

  load() {
    const { value } = loadJson(this.filePath, loaded => loaded && typeof loaded === 'object' && !Array.isArray(loaded));
    if (!value) return;
    const raw = value;
    this.friendships = normalizeFriendships(raw.friendships);
    this.blocks = normalizeBlocks(raw.blocks);
    this.invites = objectArray(raw.invites, MAX_SOCIAL_RECORDS);
    this.reports = normalizeReports(raw.reports);
    this.loadCooldowns(raw.requestCooldowns);
    const notifications = raw.notifications && typeof raw.notifications === 'object' && !Array.isArray(raw.notifications)
      ? raw.notifications
      : {};
    Object.entries(notifications).forEach(([accountId, items]) => {
      this.notifications.set(accountId, arrayOrEmpty(items).filter(item => item && typeof item === 'object').slice(0, 100).map(cleanNotification));
    });
  }

  // Only unexpired cooldowns are written, so the persisted list stays bounded
  // by MAX_COOLDOWN_ENTRIES and by the 24 hour decline window.
  liveCooldownRecords(now = Date.now()) {
    const live = [];
    for (const entry of this.requestCooldowns.values()) {
      if (entry.until > now) live.push({ fromId: entry.fromId, toId: entry.toId, until: entry.until });
    }
    return live.slice(-MAX_COOLDOWN_ENTRIES);
  }

  loadCooldowns(entries, now = Date.now()) {
    for (const entry of objectArray(entries, MAX_COOLDOWN_ENTRIES)) {
      const fromId = boundedIdentifier(entry.fromId);
      const toId = boundedIdentifier(entry.toId);
      const until = Number(entry.until);
      if (!fromId || !toId || !Number.isFinite(until) || until <= now) continue;
      this.requestCooldowns.set(`${fromId}>${toId}`, { fromId, toId, until });
    }
  }

  persist() {
    this.invites = this.invites.slice(-MAX_SOCIAL_RECORDS);
    while (this.notifications.size > MAX_SOCIAL_RECORDS) {
      this.notifications.delete(this.notifications.keys().next().value);
    }
    writeJson(this.filePath, {
      friendships: this.friendships,
      blocks: this.blocks,
      invites: this.invites,
      reports: this.reports,
      notifications: Object.fromEntries(this.notifications),
      requestCooldowns: this.liveCooldownRecords()
    });
  }

  areBlocked(firstId, secondId) {
    return this.blocks.some(block => matchesPair(block.blockerId, block.blockedId, firstId, secondId));
  }

  friendshipBetween(firstId, secondId) {
    return this.friendships.find(friendship => matchesPair(friendship.requesterId, friendship.addresseeId, firstId, secondId)) || null;
  }

  requestFriend(fromId, toId) {
    fromId = boundedIdentifier(fromId);
    toId = boundedIdentifier(toId);
    const pairError = invalidPairError(fromId, toId, 'Choose another player.');
    if (pairError) return { success: false, error: pairError };
    if (this.areBlocked(fromId, toId)) return { success: false, error: 'This player is unavailable.' };
    const existing = this.friendshipBetween(fromId, toId);
    const conflict = existingFriendshipError(existing);
    if (conflict) return { success: false, error: conflict };
    const cooldown = this.requestCooldownError(fromId, toId, existing);
    if (cooldown) return { success: false, error: cooldown };
    if (this.friendshipCount(fromId) >= MAX_FRIENDSHIPS_PER_ACCOUNT) return { success: false, error: 'Your friend list is full.' };
    if (this.pendingInboundCount(toId) >= MAX_PENDING_INBOUND_REQUESTS_PER_ACCOUNT) return { success: false, error: 'This player has too many pending friend requests.' };
    const snapshot = this.snapshot();
    if (existing) this.friendships = this.friendships.filter(entry => entry.id !== existing.id);
    const friendship = { id: id('friend'), requesterId: fromId, addresseeId: toId, status: 'requested', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    this.friendships.push(friendship);
    this.persistOrRestore(snapshot);
    return { success: true, friendship };
  }

  respondFriend(accountId, friendshipId, accept) {
    accountId = boundedIdentifier(accountId);
    friendshipId = boundedIdentifier(friendshipId);
    const friendship = this.friendships.find(entry => entry.id === friendshipId && entry.addresseeId === accountId && entry.status === 'requested');
    if (!friendship) return { success: false, error: 'That friend request is no longer available.' };
    if (accept && this.friendshipCount(accountId) >= MAX_FRIENDSHIPS_PER_ACCOUNT) return { success: false, error: 'Your friend list is full.' };
    const snapshot = this.snapshot();
    friendship.status = accept ? 'accepted' : 'declined';
    friendship.updatedAt = new Date().toISOString();
    this.persistOrRestore(snapshot);
    return { success: true, friendship };
  }

  cancelFriendRequest(accountId, friendshipId) {
    accountId = boundedIdentifier(accountId);
    friendshipId = boundedIdentifier(friendshipId);
    const index = this.friendships.findIndex(entry => entry.id === friendshipId && entry.requesterId === accountId && entry.status === 'requested');
    if (index < 0) return { success: false, error: 'That friend request is no longer pending.' };
    const snapshot = this.snapshot();
    const [cancelled] = this.friendships.splice(index, 1);
    // The target's notification for a withdrawn request would only dangle.
    const list = this.notifications.get(cancelled.addresseeId);
    if (list) this.notifications.set(cancelled.addresseeId, list.filter(item => item.metadata?.friendshipId !== cancelled.id));
    this.startRequestCooldown(cancelled.requesterId, cancelled.addresseeId);
    this.persistOrRestore(snapshot);
    return { success: true, canceled: true };
  }

  removeFriend(accountId, otherId) {
    accountId = boundedIdentifier(accountId);
    otherId = boundedIdentifier(otherId);
    if (invalidPairError(accountId, otherId, 'Friendship not found.')) return { success: false, error: 'Friendship not found.' };
    const existing = this.friendshipBetween(accountId, otherId);
    if (!existing) return { success: false, error: 'Friendship not found.' };
    const snapshot = this.snapshot();
    // Only an accepted friendship is deleted outright. A pending or declined
    // record is the caller cancelling or declining it, and keeps its cooldown.
    this.friendships = this.friendships.filter(entry => (existing.status === 'accepted'
      ? !matchesPair(entry.requesterId, entry.addresseeId, accountId, otherId)
      : entry.id !== existing.id));
    if (existing.status === 'accepted') {
      // A former friend's pending room invites (either direction) die with the friendship.
      this.invites = this.invites.filter(invite => invite.status !== 'pending' || !matchesPair(invite.senderId, invite.recipientId, accountId, otherId));
    }
    startRemovalCooldown(this, existing, accountId);
    this.persistOrRestore(snapshot);
    return { success: true };
  }

  blockPlayer(accountId, otherId) {
    accountId = boundedIdentifier(accountId);
    otherId = boundedIdentifier(otherId);
    const pairError = invalidPairError(accountId, otherId, 'Choose another player.');
    if (pairError) return { success: false, error: pairError };
    const alreadyBlocked = this.blocks.some(block => block.blockerId === accountId && block.blockedId === otherId);
    if (!alreadyBlocked && this.blocks.filter(block => block.blockerId === accountId).length >= MAX_BLOCKS_PER_ACCOUNT) {
      return { success: false, error: 'Your block list is full.' };
    }
    const snapshot = this.snapshot();
    this.friendships = this.friendships.filter(entry => !matchesPair(entry.requesterId, entry.addresseeId, accountId, otherId));
    if (!this.areBlocked(accountId, otherId)) this.blocks.push({ blockerId: accountId, blockedId: otherId, createdAt: new Date().toISOString() });
    this.invites = this.invites.filter(invite => !matchesPair(invite.senderId, invite.recipientId, accountId, otherId));
    this.persistOrRestore(snapshot);
    return { success: true };
  }

  reportPlayer(accountId, otherId, reason = 'unspecified') {
    accountId = boundedIdentifier(accountId);
    otherId = boundedIdentifier(otherId);
    const pairError = invalidPairError(accountId, otherId, 'Choose another player.');
    if (pairError) return { success: false, error: pairError };
    if (hasOpenReport(this.reports, accountId, otherId)) return { success: true };
    if (this.reports.filter(report => report.reporterId === accountId && report.status === 'open').length >= MAX_OPEN_REPORTS_PER_REPORTER) {
      return { success: false, error: 'You have too many open reports.' };
    }
    const snapshot = this.snapshot();
    this.reports.push({ id: id('report'), reporterId: accountId, reportedId: otherId, reason: String(reason).slice(0, 80), status: 'open', createdAt: new Date().toISOString() });
    this.persistOrRestore(snapshot);
    return { success: true };
  }

  // One pass over friendships for a whole summary: accepted-friend sets per
  // account and a pair lookup that matches friendshipBetween (first row wins).
  friendshipIndex() {
    const friends = new Map();
    const pairs = new Map();
    const link = (owner, other) => {
      const set = friends.get(owner);
      if (set) set.add(other); else friends.set(owner, new Set([other]));
    };
    for (const entry of this.friendships) {
      const key = friendshipKey(entry);
      if (!pairs.has(key)) pairs.set(key, entry);
      if (entry.status !== 'accepted') continue;
      link(entry.requesterId, entry.addresseeId);
      link(entry.addresseeId, entry.requesterId);
    }
    const none = new Set();
    return {
      friendIdsOf: accountId => friends.get(accountId) || none,
      friendshipBetween: (firstId, secondId) => pairs.get(friendshipKey({ requesterId: firstId, addresseeId: secondId })) || null
    };
  }

  listFor(accountId) {
    accountId = boundedIdentifier(accountId);
    this.pruneExpiredInvites();
    const friendships = this.friendships.filter(entry => involvesAccount(entry, accountId));
    const friends = friendships.filter(entry => entry.status === 'accepted').map(entry => friendIdOther(entry, accountId));
    const requests = friendships.filter(entry => isIncomingRequest(entry, accountId));
    const outgoing = friendships.filter(entry => isOutgoingRequest(entry, accountId));
    const invites = this.invites.filter(invite => isPendingInviteFor(invite, accountId));
    const notifications = notificationsFor(this.notifications, accountId).slice(0, 50).map(cleanNotification);
    return { friends, requests, outgoing, invites, notifications };
  }

  createInvite({ roomId, roomCode, roomName, visibility, senderId, recipientId }) {
    roomId = boundedIdentifier(roomId);
    roomCode = boundedIdentifier(roomCode, 32);
    senderId = boundedIdentifier(senderId);
    recipientId = boundedIdentifier(recipientId);
    const pairError = invalidPairError(senderId, recipientId, 'This player is unavailable.');
    if (pairError) return { success: false, error: pairError };
    if (!roomId && !roomCode) return { success: false, error: 'That room is unavailable.' };
    if (this.areBlocked(senderId, recipientId)) return { success: false, error: 'This player is unavailable.' };
    const existing = findPendingInvite(this.invites, roomId, roomCode, senderId, recipientId);
    if (existing) return { success: false, error: 'This room invite is already pending.' };
    const invite = { id: id('invite'), roomId: roomId || null, roomCode: roomCode || null, roomName: clipText(roomName, 120), visibility: visibility === 'private' ? 'private' : 'public', senderId, recipientId, status: 'pending', createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString() };
    const snapshot = this.snapshot();
    this.invites.push(invite);
    this.persistOrRestore(snapshot);
    return { success: true, invite };
  }

  respondInvite(accountId, inviteId, accept) {
    accountId = boundedIdentifier(accountId);
    inviteId = boundedIdentifier(inviteId);
    this.pruneExpiredInvites();
    const invite = this.invites.find(entry => entry.id === inviteId && entry.recipientId === accountId && entry.status === 'pending');
    if (!invite) return { success: false, error: 'That room invite has expired.' };
    const snapshot = this.snapshot();
    invite.status = accept ? 'accepted' : 'declined';
    invite.updatedAt = new Date().toISOString();
    this.persistOrRestore(snapshot);
    return { success: true, invite };
  }

  getInvite(accountId, inviteId) {
    accountId = boundedIdentifier(accountId);
    inviteId = boundedIdentifier(inviteId);
    this.pruneExpiredInvites();
    return this.invites.find(entry => entry.id === inviteId && entry.recipientId === accountId && entry.status === 'pending') || null;
  }

  addNotification(accountId, notification) {
    accountId = boundedIdentifier(accountId);
    if (!accountId) return;
    const snapshot = this.snapshot();
    const list = notificationsFor(this.notifications, accountId);
    list.unshift(cleanNotification({ id: id('notice'), ...notification, createdAt: notification.createdAt || new Date().toISOString() }));
    this.notifications.set(accountId, list.slice(0, 100));
    this.persistOrRestore(snapshot);
  }

  markNotificationRead(accountId, notificationId) {
    accountId = boundedIdentifier(accountId);
    notificationId = boundedIdentifier(notificationId);
    const notification = notificationsFor(this.notifications, accountId).find(entry => entry.id === notificationId);
    if (!notification) return { success: false, error: 'Notification not found.' };
    const snapshot = this.snapshot();
    notification.readAt = new Date().toISOString();
    this.persistOrRestore(snapshot);
    return { success: true };
  }

  purgeAccount(accountId, { displayName = '' } = {}) {
    const id = boundedIdentifier(accountId);
    if (!id) return false;
    const removedInviteIds = new Set(this.invites.filter(entry => entry.senderId === id || entry.recipientId === id).map(entry => entry.id));
    const before = { friendships: this.friendships.length, blocks: this.blocks.length, invites: this.invites.length, reports: this.reports.length, notification: this.notifications.has(id) };
    const notificationsBefore = JSON.stringify([...this.notifications]);
    const snapshot = this.snapshot();
    this.friendships = this.friendships.filter(entry => !involvesAccount(entry, id));
    this.blocks = this.blocks.filter(entry => entry.blockerId !== id && entry.blockedId !== id);
    this.invites = this.invites.filter(entry => entry.senderId !== id && entry.recipientId !== id);
    this.reports = this.reports.filter(entry => entry.reporterId !== id && entry.reportedId !== id);
    this.notifications.delete(id);
    const cooldownsBefore = this.requestCooldowns.size;
    for (const [key, entry] of this.requestCooldowns) if (entry.fromId === id || entry.toId === id) this.requestCooldowns.delete(key);
    // Other players' notifications about this account are part of its data too.
    for (const [owner, list] of this.notifications) {
      this.notifications.set(owner, scrubNotificationList(list, id, removedInviteIds, String(displayName || '')));
    }
    const after = { friendships: this.friendships.length, blocks: this.blocks.length, invites: this.invites.length, reports: this.reports.length, notification: this.notifications.has(id) };
    const notificationsChanged = JSON.stringify([...this.notifications]) !== notificationsBefore;
    if (before.friendships === after.friendships && before.blocks === after.blocks && before.invites === after.invites && before.reports === after.reports && before.notification === after.notification && !notificationsChanged && cooldownsBefore === this.requestCooldowns.size) return false;
    this.persistOrRestore(snapshot);
    return true;
  }
}
