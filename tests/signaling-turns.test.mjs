import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { WebSocket } from "ws";

function inbox(socket) {
  const queue = [];
  const waiters = [];
  socket.on("message", (raw) => {
    const message = JSON.parse(raw.toString());
    const index = waiters.findIndex((waiter) => waiter.type === message.type && waiter.predicate(message));
    if (index >= 0) waiters.splice(index, 1)[0].resolve(message);
    else queue.push(message);
  });
  return (type, predicate = () => true, timeout = 3000) => {
    const index = queue.findIndex((message) => message.type === type && predicate(message));
    if (index >= 0) return Promise.resolve(queue.splice(index, 1)[0]);
    return new Promise((resolve, reject) => {
      const waiter = { type, predicate, resolve };
      waiters.push(waiter);
      setTimeout(() => {
        const pending = waiters.indexOf(waiter);
        if (pending >= 0) waiters.splice(pending, 1);
        reject(new Error(`等待 ${type} 超时`));
      }, timeout);
    });
  };
}

async function freePort() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function connect(url) {
  let lastError;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const socket = new WebSocket(url);
    try {
      await new Promise((resolve, reject) => { socket.once("open", resolve); socket.once("error", reject); });
      return socket;
    } catch (error) {
      lastError = error;
      socket.close();
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
  throw lastError;
}

async function startSignalServer(t, environment = {}) {
  const port = await freePort();
  const server = spawn(process.execPath, [fileURLToPath(new URL("../server/signaling.mjs", import.meta.url))], {
    env: { ...process.env, SIGNAL_HOST: "127.0.0.1", SIGNAL_PORT: String(port), CONTROL_LEASE_SECONDS: "30", ...environment },
    stdio: ["ignore", "pipe", "pipe"],
  });
  t.after(() => server.kill("SIGTERM"));
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("信令服务启动超时")), 3000);
    server.stdout.on("data", (chunk) => {
      if (!chunk.toString().includes("Mutiny Relay 本地信令服务")) return;
      clearTimeout(timer);
      resolve();
    });
  });
  return `ws://127.0.0.1:${port}`;
}

test("校准生命周期只能由房主管理", async (t) => {
  const url = await startSignalServer(t);
  const host = await connect(url);
  const guest = await connect(url);
  t.after(() => { host.close(); guest.close(); });
  const hostNext = inbox(host);
  const guestNext = inbox(guest);

  host.send(JSON.stringify({ type: "create-room", name: "房主", mode: "free" }));
  const created = await hostNext("room-created");
  const initial = await hostNext("room-state", (message) => message.control?.ownerPeerId === created.peerId);
  assert.equal(initial.control.mode, "free");
  assert.equal(initial.control.phase, "setup");

  guest.send(JSON.stringify({ type: "join-room", roomCode: created.roomCode, name: "操作者", role: "controller" }));
  const pending = await guestNext("join-pending");
  await hostNext("join-request");
  host.send(JSON.stringify({ type: "approve-peer", peerId: pending.peerId, role: "controller" }));
  await guestNext("join-approved");
  await hostNext("peer-ready");

  guest.send(JSON.stringify({ type: "start-calibration" }));
  assert.equal((await guestNext("error")).message, "只有房主可以发起校准");
  host.send(JSON.stringify({ type: "set-calibration-ready", ready: true }));
  await guestNext("room-state", (message) => message.control?.calibrationReady === true);
  host.send(JSON.stringify({ type: "start-calibration", peerId: pending.peerId }));
  await hostNext("begin-calibration", (message) => message.peerId === pending.peerId);
  const calibration = await guestNext("room-state", (message) => message.control?.phase === "calibration");
  assert.equal(calibration.control.ownerPeerId, pending.peerId);

  host.send(JSON.stringify({ type: "calibration-progress", state: "point-1", message: "两次点击距离太近，请重新点击第一个定位点。" }));
  const retryState = await guestNext("room-state", (message) => message.control?.calibrationMessage?.includes("距离太近"));
  assert.equal(retryState.control.calibrationStep, "point-1");
  guest.send(JSON.stringify({ type: "restart-calibration" }));
  assert.equal((await guestNext("error")).message, "只有房主可以重新开始校准");
  host.send(JSON.stringify({ type: "restart-calibration" }));
  await hostNext("begin-calibration", (message) => message.peerId === pending.peerId);
  await guestNext("room-state", (message) => message.control?.phase === "calibration" && message.control.calibrationMessage === null);
  guest.send(JSON.stringify({ type: "cancel-calibration" }));
  assert.equal((await guestNext("error")).message, "只有房主可以取消校准");
  host.send(JSON.stringify({ type: "cancel-calibration" }));
  await hostNext("abort-calibration");
  await guestNext("room-state", (message) => message.control?.phase === "setup");
  host.send(JSON.stringify({ type: "start-calibration", peerId: pending.peerId }));
  await hostNext("begin-calibration", (message) => message.peerId === pending.peerId);
  await guestNext("room-state", (message) => message.control?.phase === "calibration");

  host.send(JSON.stringify({ type: "finish-calibration" }));
  await hostNext("room-state", (message) => message.control?.phase === "ready");

  host.send(JSON.stringify({ type: "start-calibration", peerId: pending.peerId }));
  await hostNext("begin-calibration", (message) => message.peerId === pending.peerId);
  await guestNext("room-state", (message) => message.control?.phase === "calibration");
  host.send(JSON.stringify({ type: "finish-calibration" }));
  await hostNext("room-state", (message) => message.control?.phase === "ready");

  host.send(JSON.stringify({ type: "start-game" }));
  await hostNext("room-state", (message) => message.control?.phase === "playing" && message.control.ownerPeerId === created.peerId);

  guest.send(JSON.stringify({ type: "reset-control-for-share" }));
  assert.equal((await guestNext("error")).message, "只有房主可以更换共享窗口");
  host.send(JSON.stringify({ type: "reset-control-for-share" }));
  await hostNext("reset-page-control");
  const switchedShare = await guestNext("room-state", (message) => message.control?.phase === "setup" && message.control.calibrationReady === false);
  assert.equal(switchedShare.roomCode, created.roomCode);
  assert.ok(switchedShare.peers.some((peer) => peer.peerId === pending.peerId && peer.approved));

  guest.close();
  await hostNext("peer-left");
});

test("通用远程控制支持重连与权限降级", async (t) => {
  const url = await startSignalServer(t);
  const host = await connect(url);
  const guest = await connect(url);
  t.after(() => { host.close(); guest.close(); });
  const hostNext = inbox(host);
  const guestNext = inbox(guest);

  host.send(JSON.stringify({ type: "create-room", name: "房主", mode: "free" }));
  const created = await hostNext("room-created");
  const initial = await hostNext("room-state", (message) => message.control?.mode === "free");
  assert.equal("turnDeadline" in initial.control, false);

  guest.send(JSON.stringify({ type: "join-room", roomCode: created.roomCode, name: "操作者", role: "controller" }));
  const pending = await guestNext("join-pending");
  await hostNext("join-request");
  host.send(JSON.stringify({ type: "approve-peer", peerId: pending.peerId, role: "controller" }));
  await guestNext("join-approved");
  await hostNext("peer-ready");
  host.send(JSON.stringify({ type: "set-calibration-ready", ready: true }));
  await guestNext("room-state", (message) => message.control?.calibrationReady === true);
  host.send(JSON.stringify({ type: "start-calibration", peerId: pending.peerId }));
  await hostNext("begin-calibration");
  await guestNext("room-state", (message) => message.control?.phase === "calibration");
  host.send(JSON.stringify({ type: "finish-calibration" }));
  await hostNext("room-state", (message) => message.control?.phase === "ready");
  host.send(JSON.stringify({ type: "start-game" }));
  const playing = await guestNext("room-state", (message) => message.control?.phase === "playing");
  assert.equal(playing.control.mode, "free");
  assert.equal("turnNumber" in playing.control, false);

  guest.send(JSON.stringify({ type: "start-calibration" }));
  assert.equal((await guestNext("error")).message, "只有房主可以发起校准");
  host.send(JSON.stringify({ type: "start-calibration", peerId: pending.peerId }));
  await hostNext("begin-calibration", (message) => message.peerId === pending.peerId);
  await guestNext("room-state", (message) => message.control?.phase === "calibration");
  host.send(JSON.stringify({ type: "finish-calibration" }));
  await hostNext("room-state", (message) => message.control?.phase === "ready");

  host.send(JSON.stringify({ type: "reset-control-session", reason: "助手重新连接" }));
  await guestNext("reload-session", (message) => message.reason === "助手重新连接");
  await guestNext("room-state", (message) => message.control?.phase === "setup" && message.control.calibrationReady === false);
  guest.send(JSON.stringify({ type: "reload-session-ready" }));
  assert.equal((await hostNext("restart-peer")).peerId, pending.peerId);
  host.send(JSON.stringify({ type: "set-calibration-ready", ready: true }));
  await guestNext("room-state", (message) => message.control?.calibrationReady === true);

  host.send(JSON.stringify({ type: "set-role", peerId: pending.peerId, role: "spectator" }));
  assert.equal((await guestNext("role-changed")).role, "spectator");
  await guestNext("reload-session");
  await guestNext("room-state", (message) => message.control?.phase === "setup");
  guest.send(JSON.stringify({ type: "reload-session-ready" }));
  assert.equal((await hostNext("restart-peer")).peerId, pending.peerId);
});
