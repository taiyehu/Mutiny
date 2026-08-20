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

test("控制权固定由蓝方房主开始并在双方之间安全轮换", async (t) => {
  const port = await freePort();
  const server = spawn(process.execPath, [fileURLToPath(new URL("../server/signaling.mjs", import.meta.url))], {
    env: { ...process.env, SIGNAL_HOST: "127.0.0.1", SIGNAL_PORT: String(port), CONTROL_LEASE_SECONDS: "30", TURN_DURATION_SECONDS: "5" },
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

  const url = `ws://127.0.0.1:${port}`;
  const host = await connect(url);
  const guest = await connect(url);
  t.after(() => { host.close(); guest.close(); });
  const hostNext = inbox(host);
  const guestNext = inbox(guest);

  host.send(JSON.stringify({ type: "create-room", name: "蓝方" }));
  const created = await hostNext("room-created");
  const initial = await hostNext("room-state", (message) => message.control?.ownerPeerId === created.peerId);
  assert.equal(initial.control.side, "blue");
  assert.equal(initial.control.phase, "setup");
  assert.equal(initial.control.turnNumber, 0);

  guest.send(JSON.stringify({ type: "join-room", roomCode: created.roomCode, name: "红方", role: "controller" }));
  const pending = await guestNext("join-pending");
  await hostNext("join-request");
  host.send(JSON.stringify({ type: "approve-peer", peerId: pending.peerId, role: "controller" }));
  await guestNext("join-approved");
  await hostNext("peer-ready");

  guest.send(JSON.stringify({ type: "pass-control" }));
  assert.equal((await guestNext("error")).message, "你当前没有控制权");

  host.send(JSON.stringify({ type: "start-calibration", peerId: pending.peerId }));
  const calibration = await guestNext("room-state", (message) => message.control?.phase === "calibration");
  assert.equal(calibration.control.ownerPeerId, pending.peerId);
  assert.equal(calibration.control.turnNumber, 0);

  guest.send(JSON.stringify({ type: "pass-control" }));
  assert.equal((await guestNext("error")).message, "你当前没有控制权");

  host.send(JSON.stringify({ type: "finish-calibration" }));
  const ready = await hostNext("room-state", (message) => message.control?.phase === "ready");
  assert.equal(ready.control.turnNumber, 0);
  assert.equal(ready.control.turnDeadline, null);

  host.send(JSON.stringify({ type: "start-game" }));
  const firstTurn = await hostNext("room-state", (message) => message.control?.phase === "playing" && message.control.ownerPeerId === created.peerId);
  assert.equal(firstTurn.control.turnNumber, 1);
  assert.ok(firstTurn.control.turnDeadline > Date.now());

  host.send(JSON.stringify({ type: "pass-control" }));
  const redTurn = await guestNext("room-state", (message) => message.control?.phase === "playing" && message.control.ownerPeerId === pending.peerId);
  assert.equal(redTurn.control.side, "red");

  const timedOut = await hostNext("room-state", (message) => message.control?.ownerPeerId === created.peerId && message.control.turnNumber >= 3, 7000);
  assert.equal(timedOut.control.side, "blue");

  host.send(JSON.stringify({ type: "pass-control" }));
  await guestNext("room-state", (message) => message.control?.ownerPeerId === pending.peerId && message.control.turnNumber >= 4);
  guest.close();
  await hostNext("peer-left");
  const recovered = await hostNext("room-state", (message) => message.control?.ownerPeerId === created.peerId && message.control.turnNumber >= 5);
  assert.equal(recovered.control.side, "blue");
});
