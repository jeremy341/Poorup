import crypto from 'crypto';
import { fileURLToPath } from 'url';
import path from 'path';
import { loadJson, writeJson } from './storeIO.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_FILE = path.join(__dirname, 'data', 'social.json');

function id(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function clipText(value, maxLength) {
  return String(value || '').slice(0, maxLength);
}

function metadataOrEmpty(metadata) {
  return metadata && typeof metadata === 'object' ? metadata : {};
}

function cleanNotification(notification) {
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

function findPendingInvite(invites, roomCode, senderId, recipientId) {
  return invites.find(invite => invite.roomCode === roomCode && invite.senderId === senderId && invite.recipientId === recipientId && invite.status === 'pending');
}

function isOpenReport(report, accountId, otherId) {
  if (report.reporterId !== accountId) return false;
  if (report.reportedId !== otherId) return false;
  return report.status === 'open';
}

function hasOpenReport(reports, accountId, otherId) {
  return reports.some(report => isOpenReport(report, accountId, otherId));
}

export class SocialStore {
  constructor(filePath = DEFAULT_FILE) {
    this.filePath = filePath;
    this.friendships = [];
    this.blocks = [];
    this.invites = [];
    this.reports = [];
    this.notifications = new Map();
    this.load();
  }

  load() {
    const { value } = loadJson(this.filePath);
    if (!value) return;
    const raw = value;
    this.friendships = arrayOrEmpty(raw.friendships);
    this.blocks = arrayOrEmpty(raw.blocks);
    this.invites = arrayOrEmpty(raw.invites);
    this.reports = arrayOrEmpty(raw.reports);
    Object.entries(raw.notifications || {}).forEach(([accountId, items]) => {
      this.notifications.set(accountId, Array.isArray(items) ? items.map(cleanNotification) : []);
    });
  }

  persist() {
    writeJson(this.filePath, {
      friendships: this.friendships,
      blocks: this.blocks,
      invites: this.invites,
      reports: this.reports,
      notifications: Object.fromEntries(this.notifications)
    });
  }

  areBlocked(firstId, secondId) {
    return this.blocks.some(block => matchesPair(block.blockerId, block.blockedId, firstId, secondId));
  }

  friendshipBetween(firstId, secondId) {
    return this.friendships.find(friendship => matchesPair(friendship.requesterId, friendship.addresseeId, firstId, secondId)) || null;
  }

  requestFriend(fromId, toId) {
    const pairError = invalidPairError(fromId, toId, 'Choose another player.');
    if (pairError) return { success: false, error: pairError };
    if (this.areBlocked(fromId, toId)) return { success: false, error: 'This player is unavailable.' };
    const existing = this.friendshipBetween(fromId, toId);
    const conflict = existingFriendshipError(existing);
    if (conflict) return { success: false, error: conflict };
    if (existing) this.friendships = this.friendships.filter(entry => entry.id !== existing.id);
    const friendship = { id: id('friend'), requesterId: fromId, addresseeId: toId, status: 'requested', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    this.friendships.push(friendship);
    this.persist();
    return { success: true, friendship };
  }

  respondFriend(accountId, friendshipId, accept) {
    const friendship = this.friendships.find(entry => entry.id === friendshipId && entry.addresseeId === accountId && entry.status === 'requested');
    if (!friendship) return { success: false, error: 'That friend request is no longer available.' };
    friendship.status = accept ? 'accepted' : 'declined';
    friendship.updatedAt = new Date().toISOString();
    this.persist();
    return { success: true, friendship };
  }

  cancelFriendRequest(accountId, friendshipId) {
    const index = this.friendships.findIndex(entry => entry.id === friendshipId && entry.requesterId === accountId && entry.status === 'requested');
    if (index < 0) return { success: false, error: 'That friend request is no longer pending.' };
    this.friendships.splice(index, 1);
    this.persist();
    return { success: true, canceled: true };
  }

  removeFriend(accountId, otherId) {
    const before = this.friendships.length;
    this.friendships = this.friendships.filter(entry => !matchesPair(entry.requesterId, entry.addresseeId, accountId, otherId));
    if (this.friendships.length === before) return { success: false, error: 'Friendship not found.' };
    this.persist();
    return { success: true };
  }

  blockPlayer(accountId, otherId) {
    const pairError = invalidPairError(accountId, otherId, 'Choose another player.');
    if (pairError) return { success: false, error: pairError };
    this.friendships = this.friendships.filter(entry => !matchesPair(entry.requesterId, entry.addresseeId, accountId, otherId));
    if (!this.areBlocked(accountId, otherId)) this.blocks.push({ blockerId: accountId, blockedId: otherId, createdAt: new Date().toISOString() });
    this.invites = this.invites.filter(invite => !matchesPair(invite.senderId, invite.recipientId, accountId, otherId));
    this.persist();
    return { success: true };
  }

  reportPlayer(accountId, otherId, reason = 'unspecified') {
    const pairError = invalidPairError(accountId, otherId, 'Choose another player.');
    if (pairError) return { success: false, error: pairError };
    if (hasOpenReport(this.reports, accountId, otherId)) return { success: true };
    this.reports.push({ id: id('report'), reporterId: accountId, reportedId: otherId, reason: String(reason).slice(0, 80), status: 'open', createdAt: new Date().toISOString() });
    this.persist();
    return { success: true };
  }

  listFor(accountId) {
    const friendships = this.friendships.filter(entry => involvesAccount(entry, accountId));
    const friends = friendships.filter(entry => entry.status === 'accepted').map(entry => friendIdOther(entry, accountId));
    const requests = friendships.filter(entry => isIncomingRequest(entry, accountId));
    const outgoing = friendships.filter(entry => isOutgoingRequest(entry, accountId));
    const invites = this.invites.filter(invite => isPendingInviteFor(invite, accountId));
    const notifications = notificationsFor(this.notifications, accountId).slice(0, 50).map(cleanNotification);
    return { friends, requests, outgoing, invites, notifications };
  }

  createInvite({ roomCode, roomName, visibility, senderId, recipientId }) {
    const pairError = invalidPairError(senderId, recipientId, 'This player is unavailable.');
    if (pairError) return { success: false, error: pairError };
    if (this.areBlocked(senderId, recipientId)) return { success: false, error: 'This player is unavailable.' };
    const existing = findPendingInvite(this.invites, roomCode, senderId, recipientId);
    if (existing) return { success: false, error: 'This room invite is already pending.' };
    const invite = { id: id('invite'), roomCode, roomName, visibility, senderId, recipientId, status: 'pending', createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString() };
    this.invites.push(invite);
    this.persist();
    return { success: true, invite };
  }

  respondInvite(accountId, inviteId, accept) {
    const invite = this.invites.find(entry => entry.id === inviteId && entry.recipientId === accountId && entry.status === 'pending');
    if (!invite) return { success: false, error: 'That room invite has expired.' };
    if (Date.parse(invite.expiresAt || '') <= Date.now()) {
      invite.status = 'expired';
      invite.updatedAt = new Date().toISOString();
      this.persist();
      return { success: false, error: 'That room invite has expired.' };
    }
    invite.status = accept ? 'accepted' : 'declined';
    invite.updatedAt = new Date().toISOString();
    this.persist();
    return { success: true, invite };
  }

  getInvite(accountId, inviteId) {
    return this.invites.find(entry => entry.id === inviteId && entry.recipientId === accountId && entry.status === 'pending') || null;
  }

  addNotification(accountId, notification) {
    if (!accountId) return;
    const list = notificationsFor(this.notifications, accountId);
    list.unshift(cleanNotification({ id: id('notice'), ...notification, createdAt: notification.createdAt || new Date().toISOString() }));
    this.notifications.set(accountId, list.slice(0, 100));
    this.persist();
  }

  markNotificationRead(accountId, notificationId) {
    const notification = notificationsFor(this.notifications, accountId).find(entry => entry.id === notificationId);
    if (!notification) return { success: false, error: 'Notification not found.' };
    notification.readAt = new Date().toISOString();
    this.persist();
    return { success: true };
  }
}
