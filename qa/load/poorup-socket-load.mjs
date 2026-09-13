#!/usr/bin/env node
// Bounded Socket.IO capacity harness. It is deliberately opt-in and refuses
// production-looking targets. Run only against a disposable Nest testing
// deployment (or localhost with POORUP_LOAD_ALLOW_LOCAL=true).
import { io } from 'socket.io-client';

const target = String(process.env.POORUP_LOAD_TARGET || '').trim();
const environment = String(process.env.POORUP_LOAD_ENV || '').trim().toLowerCase();
const allowLocal = String(process.env.POORUP_LOAD_ALLOW_LOCAL || '').toLowerCase() === 'true';
const clientCount = Math.max(1, Math.min(1000, Math.floor(Number(process.env.POORUP_LOAD_CLIENTS) || 1000)));
const roomSize = 4;

if (!target || environment !== 'testing') {
  throw new Error('Set POORUP_LOAD_TARGET and POORUP_LOAD_ENV=testing before running the capacity harness.');
}
const url = new URL(target);
if (!allowLocal && ['localhost', '127.0.0.1', '::1'].includes(url.hostname)) {
  throw new Error('Local targets require POORUP_LOAD_ALLOW_LOCAL=true.');
}
if (/production|poorup\.jeremy-d\.hackclub\.app$/i.test(url.hostname)) {
  throw new Error('The capacity harness refuses production-looking hosts.');
}

const stats = { startedAt: Date.now(), connected: 0, failed: 0, listed: 0, created: 0, joined: 0, reconnects: 0, reconnectFailures: 0, latencies: [] };
const sockets = [];

function wait(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

function connectSocket(index) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const socket = io(target, { path: '/socket.io', transports: ['websocket'], reconnection: false, timeout: 10_000 });
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      if (error) { stats.failed += 1; reject(error); return; }
      stats.connected += 1;
      stats.latencies.push(Date.now() - started);
      resolve(socket);
    };
    socket.once('connect', () => finish());
    socket.once('connect_error', error => finish(error));
    socket.data = { index };
  });
}

function ack(socket, event, payload = {}) {
  return new Promise(resolve => {
    const timer = setTimeout(() => resolve({ success: false, error: 'timeout' }), 8_000);
    socket.emit(event, payload, response => { clearTimeout(timer); resolve(response || {}); });
  });
}

async function run() {
  const started = Date.now();
  for (let index = 0; index < clientCount; index += 1) {
    try { sockets.push(await connectSocket(index)); } catch { /* counted in stats */ }
    if (index % 50 === 49) await wait(10);
  }
  await Promise.all(sockets.map(async socket => {
    const response = await ack(socket, 'list-rooms');
    if (response.success) stats.listed += 1;
  }));

  const roomCount = Math.ceil(sockets.length / roomSize);
  const rooms = [];
  for (let index = 0; index < roomCount; index += 1) {
    const socket = sockets[index * roomSize];
    if (!socket) continue;
    const response = await ack(socket, 'create-room', {
      nickname: `load-host-${index}`,
      visibility: 'public',
      roomName: `LOAD ${index}`,
      requestId: `load-${Date.now()}-${index}`
    });
    if (response.success && response.roomCode) { rooms.push(response.roomCode); stats.created += 1; }
  }
  for (let index = 0; index < rooms.length; index += 1) {
    const roomCode = rooms[index];
    const first = index * roomSize;
    for (let offset = 1; offset < roomSize; offset += 1) {
      const socket = sockets[first + offset];
      if (!socket) continue;
      const response = await ack(socket, 'join-room', { roomCode, nickname: `load-seat-${first + offset}` });
      if (response.success) stats.joined += 1;
    }
  }

  // Reconnect a bounded sample to measure recovery without turning the test
  // into a reconnect storm.
  const sample = sockets.filter((_socket, index) => index % 20 === 0).slice(0, 50);
  for (const socket of sample) {
    const id = socket.data?.index;
    socket.disconnect();
    try {
      const restored = await connectSocket(id);
      stats.reconnects += 1;
      restored.close();
    } catch { stats.reconnectFailures += 1; }
  }
  sockets.forEach(socket => socket.close());
  const sorted = stats.latencies.slice().sort((a, b) => a - b);
  const p95 = sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] : null;
  const result = {
    environment,
    target: `${url.origin}${url.pathname}`,
    clients: clientCount,
    durationMs: Date.now() - started,
    connected: stats.connected,
    failed: stats.failed,
    listed: stats.listed,
    roomsCreated: stats.created,
    joins: stats.joined,
    reconnects: stats.reconnects,
    reconnectFailures: stats.reconnectFailures,
    connectP95Ms: p95,
    pass: stats.failed === 0 && stats.reconnectFailures === 0 && stats.reconnects >= Math.min(50, Math.ceil(clientCount / 20)) * 0.99
  };
  console.log(JSON.stringify(result, null, 2));
  if (!result.pass) process.exitCode = 1;
}

run().catch(error => { console.error(error.message); process.exitCode = 1; });
