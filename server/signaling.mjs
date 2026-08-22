import { WebSocketServer, WebSocket } from "ws";
import crypto from "node:crypto";

const port = Number(process.env.SIGNAL_PORT || 8787);
const host = process.env.SIGNAL_HOST || "127.0.0.1";
const rooms = new Map();
const alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const turnKeyId = process.env.CLOUDFLARE_TURN_KEY_ID;
const turnApiToken = process.env.CLOUDFLARE_TURN_API_TOKEN;
const turnTtlSeconds = Math.min(86_400, Math.max(600, Number(process.env.TURN_TTL_SECONDS || 3600)));
const controlLeaseMs = Math.min(10 * 60_000, Math.max(30_000, Number(process.env.CONTROL_LEASE_SECONDS || 90) * 1000));
let turnCache = null;

function urls(value, fallback = []) {
  return value?.split(",").map((item) => item.trim()).filter(Boolean) ?? fallback;
}

function fallbackIceConfiguration(error = null) {
  const iceServers = [{ urls: urls(process.env.STUN_URLS, ["stun:stun.l.google.com:19302"]) }];
  const turnUrls = urls(process.env.TURN_URLS);
  if (turnUrls.length) iceServers.push({ urls: turnUrls, username: process.env.TURN_USERNAME, credential: process.env.TURN_CREDENTIAL });
  return { iceServers, turnEnabled: turnUrls.length > 0, error };
}

async function iceConfiguration() {
  if (!turnKeyId || !turnApiToken) return fallbackIceConfiguration();
  if (turnCache?.expiresAt > Date.now()) return turnCache.value;
  try {
    const response = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(turnKeyId)}/credentials/generate-ice-servers`, {
      method: "POST",
      headers: { authorization: `Bearer ${turnApiToken}`, "content-type": "application/json" },
      body: JSON.stringify({ ttl: turnTtlSeconds }),
      signal: AbortSignal.timeout(7000),
    });
    if (!response.ok) throw new Error(`Cloudflare TURN 返回 HTTP ${response.status}`);
    const result = await response.json();
    if (!Array.isArray(result.iceServers) || result.iceServers.length < 2) throw new Error("Cloudflare TURN 返回格式不正确");
    const iceServers = result.iceServers.map((server) => ({
      ...server,
      urls: (Array.isArray(server.urls) ? server.urls : [server.urls]).filter((url) => !/:53(?:\?|$)/.test(url)),
    })).filter((server) => server.urls.length);
    const value = { iceServers, turnEnabled: iceServers.some((server) => server.urls.some((url) => String(url).startsWith("turn"))), error: null };
    turnCache = { value, expiresAt: Date.now() + Math.max(60, turnTtlSeconds - 60) * 1000 };
    return value;
  } catch (error) {
    console.error(`TURN 凭据获取失败：${error.message}`);
    return fallbackIceConfiguration("TURN 凭据获取失败，已回退到 STUN");
  }
}

function id(size = 8) {
  return crypto.randomBytes(size).toString("hex");
}

function roomCode() {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    let code = "";
    for (let i = 0; i < 6; i += 1) code += alphabet[crypto.randomInt(alphabet.length)];
    if (!rooms.has(code)) return code;
  }
  throw new Error("无法生成房间码");
}

function send(socket, message) {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

function publicPeers(room) {
  return [...room.peers.values()].map(({ peerId, name, role, approved }) => ({ peerId, name, role, approved }));
}

function controlState(room) {
  const owner = room.controlOwnerPeerId === room.host.peerId ? room.host : room.peers.get(room.controlOwnerPeerId);
  return {
    ownerPeerId: room.controlOwnerPeerId,
    ownerName: owner?.name || "房主",
    phase: room.controlPhase,
    mode: "free",
    calibrationReady: room.hostCalibrationReady,
    calibrationStep: room.calibrationStep,
    calibrationMessage: room.calibrationMessage,
    leaseUntil: room.controlLeaseUntil,
  };
}

function broadcastRoom(room) {
  const message = { type: "room-state", roomCode: room.code, peers: publicPeers(room), control: controlState(room) };
  send(room.host.socket, message);
  for (const peer of room.peers.values()) send(peer.socket, message);
}

function giveControlToHost(room) {
  room.controlOwnerPeerId = room.host.peerId;
  room.controlLeaseUntil = Date.now() + controlLeaseMs;
}

function resetCalibration(room) {
  room.controlPhase = "setup";
  room.calibrationStep = "off";
  room.calibrationMessage = null;
  giveControlToHost(room);
  send(room.host.socket, { type: "abort-calibration" });
}

function resetControlSession(room, { clearCalibrationReady = false, reloadPeers = false, reason = "控制环境已更新，正在重新载入连接" } = {}) {
  if (room.controlPhase === "calibration") send(room.host.socket, { type: "abort-calibration" });
  else send(room.host.socket, { type: "reset-page-control" });
  room.controlPhase = "setup";
  room.calibrationStep = "off";
  room.calibrationMessage = null;
  if (clearCalibrationReady) room.hostCalibrationReady = false;
  giveControlToHost(room);
  if (reloadPeers) {
    for (const peer of room.peers.values()) {
      if (peer.approved) send(peer.socket, { type: "reload-session", reason });
    }
  }
}

function closeRoom(room, reason = "房主已关闭房间") {
  for (const peer of room.peers.values()) {
    send(peer.socket, { type: "room-closed", reason });
    peer.socket.close(4001, reason);
  }
  rooms.delete(room.code);
}

const wss = new WebSocketServer({ host, port });

wss.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.error(`信令端口 ${host}:${port} 已被占用。请关闭旧的 npm run dev / npm run dev:signal 终端，或在 .env.local 中设置其他 SIGNAL_PORT。`);
  } else {
    console.error(`信令服务启动失败：${error.message}`);
  }
  process.exitCode = 1;
});

wss.on("connection", (socket) => {
  socket.isAlive = true;
  socket.on("pong", () => { socket.isAlive = true; });
  const client = { socket, peerId: id(), roomCode: null, isHost: false };

  socket.on("message", (raw) => {
    let message;
    try { message = JSON.parse(raw.toString()); } catch { return send(socket, { type: "error", message: "消息格式错误" }); }

    if (message.type === "get-ice-servers") {
      void iceConfiguration().then((configuration) => send(socket, { type: "ice-servers", ...configuration }));
      return;
    }

    if (message.type === "create-room") {
      if (client.roomCode) return;
      const code = roomCode();
      const room = {
        code,
        mode: "free",
        host: { socket, peerId: client.peerId, name: String(message.name || "房主").slice(0, 24) },
        peers: new Map(),
        createdAt: Date.now(),
        controlOwnerPeerId: client.peerId,
        controlPhase: "setup",
        controlLeaseUntil: Date.now() + controlLeaseMs,
        hostCalibrationReady: false,
        calibrationStep: "off",
        calibrationMessage: null,
      };
      rooms.set(code, room);
      client.roomCode = code;
      client.isHost = true;
      send(socket, { type: "room-created", roomCode: code, peerId: client.peerId });
      broadcastRoom(room);
      return;
    }

    if (message.type === "join-room") {
      const code = String(message.roomCode || "").trim().toUpperCase();
      const room = rooms.get(code);
      if (!room) return send(socket, { type: "error", message: "房间不存在或已经关闭" });
      if (room.peers.size >= 8) return send(socket, { type: "error", message: "房间人数已达到本地测试上限" });
      const peer = {
        socket,
        peerId: client.peerId,
        name: String(message.name || "访客").slice(0, 24),
        role: message.role === "controller" ? "controller" : "spectator",
        approved: false,
      };
      room.peers.set(client.peerId, peer);
      client.roomCode = code;
      send(socket, { type: "join-pending", roomCode: code, peerId: client.peerId });
      send(room.host.socket, { type: "join-request", peer: { peerId: peer.peerId, name: peer.name, role: peer.role } });
      broadcastRoom(room);
      return;
    }

    const room = rooms.get(client.roomCode);
    if (!room) return send(socket, { type: "error", message: "当前不在房间中" });

    if (message.type === "control-heartbeat") {
      if (room.controlOwnerPeerId === client.peerId) room.controlLeaseUntil = Date.now() + controlLeaseMs;
      return;
    }

    if (message.type === "set-calibration-ready" && client.isHost) {
      room.hostCalibrationReady = Boolean(message.ready);
      if (!room.hostCalibrationReady && room.controlPhase === "calibration") {
        resetCalibration(room);
      }
      broadcastRoom(room);
      return;
    }

    if (message.type === "reset-control-session" && client.isHost) {
      resetControlSession(room, { clearCalibrationReady: true, reloadPeers: true, reason: String(message.reason || "房主页面助手已重新连接，正在重新载入控制连接") });
      broadcastRoom(room);
      return;
    }

    if (message.type === "reset-control-for-share") {
      if (!client.isHost) return send(socket, { type: "error", message: "只有房主可以更换共享窗口" });
      resetControlSession(room, { clearCalibrationReady: true, reloadPeers: false });
      broadcastRoom(room);
      return;
    }

    if (message.type === "reload-session-ready" && !client.isHost) {
      const peer = room.peers.get(client.peerId);
      if (peer?.approved) send(room.host.socket, { type: "restart-peer", peerId: peer.peerId });
      return;
    }

    if (message.type === "start-calibration") {
      if (!client.isHost) return send(socket, { type: "error", message: "只有房主可以发起校准" });
      const peer = room.peers.get(message.peerId);
      if (!peer?.approved || peer.role !== "controller") return send(socket, { type: "error", message: "请选择已批准的远端操作者进行校准" });
      if (room.controlPhase === "calibration") return send(socket, { type: "error", message: "校准正在进行；请使用重新开始按钮" });
      if (!room.hostCalibrationReady) return send(socket, { type: "error", message: "房主尚未连接助手并选定目标页面" });
      room.controlPhase = "calibration";
      room.calibrationStep = "point-1";
      room.calibrationMessage = null;
      room.controlOwnerPeerId = peer.peerId;
      room.controlLeaseUntil = Date.now() + controlLeaseMs;
      send(room.host.socket, { type: "begin-calibration", peerId: peer.peerId });
      broadcastRoom(room);
      return;
    }

    if (message.type === "restart-calibration") {
      if (!client.isHost) return send(socket, { type: "error", message: "只有房主可以重新开始校准" });
      if (room.controlPhase !== "calibration") return send(socket, { type: "error", message: "当前没有正在进行的校准" });
      const peer = room.peers.get(room.controlOwnerPeerId);
      if (!peer?.approved || peer.role !== "controller") return send(socket, { type: "error", message: "当前校准操作者已不可用" });
      if (!room.hostCalibrationReady) return send(socket, { type: "error", message: "房主页面助手已断开" });
      room.calibrationStep = "point-1";
      room.calibrationMessage = null;
      room.controlLeaseUntil = Date.now() + controlLeaseMs;
      send(room.host.socket, { type: "begin-calibration", peerId: peer.peerId });
      broadcastRoom(room);
      return;
    }

    if (message.type === "calibration-progress" && client.isHost && room.controlPhase === "calibration") {
      if (["point-1", "point-2"].includes(message.state)) room.calibrationStep = message.state;
      room.calibrationMessage = message.message ? String(message.message).slice(0, 160) : null;
      broadcastRoom(room);
      return;
    }

    if (message.type === "cancel-calibration") {
      if (!client.isHost) return send(socket, { type: "error", message: "只有房主可以取消校准" });
      if (room.controlPhase !== "calibration") return;
      const peer = room.peers.get(message.peerId);
      if (peer) send(peer.socket, { type: "error", message: String(message.reason || "房主的页面助手尚未准备好") });
      resetCalibration(room);
      broadcastRoom(room);
      return;
    }

    if (message.type === "finish-calibration" && client.isHost && room.controlPhase === "calibration") {
      room.controlPhase = "ready";
      room.calibrationStep = "complete";
      room.calibrationMessage = null;
      giveControlToHost(room);
      broadcastRoom(room);
      return;
    }

    if (message.type === "start-game" && client.isHost && room.controlPhase === "ready") {
      room.controlPhase = "playing";
      giveControlToHost(room);
      broadcastRoom(room);
      return;
    }

    if (message.type === "reclaim-control" && client.isHost) {
      if (room.controlPhase === "calibration") resetCalibration(room);
      else if (room.controlOwnerPeerId !== room.host.peerId) giveControlToHost(room);
      else room.controlLeaseUntil = Date.now() + controlLeaseMs;
      broadcastRoom(room);
      return;
    }

    if (message.type === "close-room" && client.isHost) {
      closeRoom(room, "房主已关闭房间并收回控制权");
      return;
    }

    if (message.type === "approve-peer" && client.isHost) {
      const peer = room.peers.get(message.peerId);
      if (!peer) return;
      peer.approved = true;
      peer.role = message.role === "controller" ? "controller" : "spectator";
      send(peer.socket, { type: "join-approved", roomCode: room.code, peerId: peer.peerId, role: peer.role });
      send(room.host.socket, { type: "peer-ready", peer: { peerId: peer.peerId, name: peer.name, role: peer.role } });
      broadcastRoom(room);
      return;
    }

    if (message.type === "reject-peer" && client.isHost) {
      const peer = room.peers.get(message.peerId);
      if (!peer) return;
      send(peer.socket, { type: "join-rejected", reason: "房主拒绝了加入请求" });
      peer.socket.close(4003, "rejected");
      room.peers.delete(message.peerId);
      broadcastRoom(room);
      return;
    }

    if (message.type === "set-role" && client.isHost) {
      const peer = room.peers.get(message.peerId);
      if (!peer?.approved) return;
      peer.role = message.role === "controller" ? "controller" : "spectator";
      resetControlSession(room, { reason: "你的房间身份已变更，正在重新载入控制连接" });
      send(peer.socket, { type: "role-changed", role: peer.role });
      send(peer.socket, { type: "reload-session", reason: "你的房间身份已变更，正在重新载入控制连接" });
      broadcastRoom(room);
      return;
    }

    if (message.type === "signal") {
      if (client.isHost) {
        const target = room.peers.get(message.target);
        if (target?.approved) send(target.socket, { type: "signal", from: client.peerId, data: message.data });
      } else {
        const peer = room.peers.get(client.peerId);
        if (peer?.approved) send(room.host.socket, { type: "signal", from: client.peerId, data: message.data });
      }
      return;
    }

    if (message.type === "kick-peer" && client.isHost) {
      const peer = room.peers.get(message.peerId);
      if (!peer) return;
      send(peer.socket, { type: "room-closed", reason: "你已被房主移出房间" });
      peer.socket.close(4004, "kicked");
      room.peers.delete(message.peerId);
      if (room.controlOwnerPeerId === message.peerId) {
        if (room.controlPhase === "calibration") resetCalibration(room);
        else giveControlToHost(room);
      }
      broadcastRoom(room);
    }
  });

  socket.on("close", () => {
    const room = rooms.get(client.roomCode);
    if (!room) return;
    if (client.isHost) return closeRoom(room);
    if (room.peers.delete(client.peerId)) {
      if (room.controlOwnerPeerId === client.peerId) {
        if (room.controlPhase === "calibration") resetCalibration(room);
        else giveControlToHost(room);
      }
      send(room.host.socket, { type: "peer-left", peerId: client.peerId });
      broadcastRoom(room);
    }
  });
});

const cleanup = setInterval(() => {
  const cutoff = Date.now() - 12 * 60 * 60 * 1000;
  for (const room of rooms.values()) {
    if (room.createdAt < cutoff) {
      closeRoom(room, "房间已超时关闭");
    } else if (room.controlOwnerPeerId !== room.host.peerId && room.controlLeaseUntil < Date.now()) {
      if (room.controlPhase === "calibration") resetCalibration(room);
      else giveControlToHost(room);
      broadcastRoom(room);
    }
  }
}, 1_000);
cleanup.unref();

const keepalive = setInterval(() => {
  for (const socket of wss.clients) {
    if (socket.isAlive === false) {
      socket.terminate();
      continue;
    }
    socket.isAlive = false;
    socket.ping();
  }
}, 20_000);
keepalive.unref();

wss.on("listening", () => {
  console.log(`Mutiny Relay 本地信令服务：http://${host}:${port}`);
  console.log(`TURN：${turnKeyId && turnApiToken ? "Cloudflare 短期凭据" : urls(process.env.TURN_URLS).length ? "静态 TURN" : "未配置（仅 STUN）"}`);
});
