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

function cleanNotification(notification) {
  return {
    id: notification.id,
    kind: notification.kind,
    title: String(notification.title || '').slice(0, 120),
    body: String(notification.body || '').slice(0, 250),
    createdAt: notification.createdAt,
    readAt: notification.readAt || null,
    metadata: notification.metadata && typeof notification.metadata === 'object' ? notification.metadata : {}
  };
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
    this.friendships = Array.isArray(raw.friendships) ? raw.friendships : [];
    this.blocks = Array.isArray(raw.blocks) ? raw.blocks : [];
    this.invites = Array.isArray(raw.invites) ? raw.invites : [];
    this.reports = Array.isArray(raw.reports) ? raw.reports : [];
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
    return this.blocks.some(block => (block.blockerId === firstId && block.blockedId === secondId) || (block.blockerId === secondId && block.blockedId === firstId));
  }

  friendshipBetween(firstId, secondId) {
    return this.friendships.find(friendship => (friendship.requesterId === firstId && friendship.addresseeId === secondId) || (friendship.requesterId === secondId && friendship.addresseeId === firstId)) || null;
  }

  requestFriend(fromId, toId) {
    if (!fromId || !toId || fromId === toId) return { success: false, error: 'Choose another player.' };
    if (this.areBlocked(fromId, toId)) return { success: false, error: 'This player is unavailable.' };
    const existing = this.friendshipBetween(fromId, toId);
    if (existing?.status === 'accepted') return { success: false, error: 'You are already friends.' };
    if (existing?.status === 'requested') return { success: false, error: 'A friend request is already pending.' };
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
    this.friendships = this.friendships.filter(entry => !((entry.requesterId === accountId && entry.addresseeId === otherId) || (entry.requesterId === otherId && entry.addresseeId === accountId)));
    if (this.friendships.length === before) return { success: false, error: 'Friendship not found.' };
    this.persist();
    return { success: true };
  }

  blockPlayer(accountId, otherId) {
    if (!accountId || !otherId || accountId === otherId) return { success: false, error: 'Choose another player.' };
    this.friendships = this.friendships.filter(entry => !((entry.requesterId === accountId && entry.addresseeId === otherId) || (entry.requesterId === otherId && entry.addresseeId === accountId)));
    if (!this.areBlocked(accountId, otherId)) this.blocks.push({ blockerId: accountId, blockedId: otherId, createdAt: new Date().toISOString() });
    this.invites = this.invites.filter(invite => !((invite.senderId === accountId && invite.recipientId === otherId) || (invite.senderId === otherId && invite.recipientId === accountId)));
    this.persist();
    return { success: true };
  }

  reportPlayer(accountId, otherId, reason = 'unspecified') {
    if (!accountId || !otherId || accountId === otherId) return { success: false, error: 'Choose another player.' };
    if (!this.reports.some(report => report.reporterId === accountId && report.reportedId === otherId && report.status === 'open')) {
      this.reports.push({ id: id('report'), reporterId: accountId, reportedId: otherId, reason: String(reason).slice(0, 80), status: 'open', createdAt: new Date().toISOString() });
      this.persist();
    }
    return { success: true };
  }

  listFor(accountId) {
    const friendships = this.friendships.filter(entry => entry.requesterId === accountId || entry.addresseeId === accountId);
    const friends = friendships.filter(entry => entry.status === 'accepted').map(entry => entry.requesterId === accountId ? entry.addresseeId : entry.requesterId);
    const requests = friendships.filter(entry => entry.status === 'requested' && entry.addresseeId === accountId);
    const outgoing = friendships.filter(entry => entry.status === 'requested' && entry.requesterId === accountId);
    const invites = this.invites.filter(invite => invite.recipientId === accountId && invite.status === 'pending');
    const notifications = (this.notifications.get(accountId) || []).slice(0, 50).map(cleanNotification);
    return { friends, requests, outgoing, invites, notifications };
  }

  createInvite({ roomCode, roomName, visibility, senderId, recipientId }) {
    if (!senderId || !recipientId || senderId === recipientId || this.areBlocked(senderId, recipientId)) return { success: false, error: 'This player is unavailable.' };
    const existing = this.invites.find(invite => invite.roomCode === roomCode && invite.senderId === senderId && invite.recipientId === recipientId && invite.status === 'pending');
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
    const list = this.notifications.get(accountId) || [];
    list.unshift(cleanNotification({ id: id('notice'), ...notification, createdAt: notification.createdAt || new Date().toISOString() }));
    this.notifications.set(accountId, list.slice(0, 100));
    this.persist();
  }

  markNotificationRead(accountId, notificationId) {
    const notification = (this.notifications.get(accountId) || []).find(entry => entry.id === notificationId);
    if (!notification) return { success: false, error: 'Notification not found.' };
    notification.readAt = new Date().toISOString();
    this.persist();
    return { success: true };
  }
}
