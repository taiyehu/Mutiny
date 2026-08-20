import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { WebSocket, WebSocketServer } from "ws";

function waitForOutput(stream, pattern, timeout = 3000) {
  return new Promise((resolve, reject) => {
    let output = "";
    const timer = setTimeout(() => reject(new Error(`等待助手输出超时：${output}`)), timeout);
    stream.on("data", (chunk) => {
      output += chunk.toString();
      const match = pattern.exec(output);
      if (!match) return;
      clearTimeout(timer);
      resolve(match);
    });
  });
}

function inbox(socket) {
  const queued = [];
  const waiting = [];
  socket.on("message", (raw) => {
    const message = JSON.parse(raw.toString());
    const index = waiting.findIndex((entry) => entry.type === message.type);
    if (index >= 0) waiting.splice(index, 1)[0].resolve(message);
    else queued.push(message);
  });
  return (type, timeout = 3000) => {
    const index = queued.findIndex((message) => message.type === type);
    if (index >= 0) return Promise.resolve(queued.splice(index, 1)[0]);
    return new Promise((resolve, reject) => {
      const entry = { type, resolve };
      waiting.push(entry);
      setTimeout(() => {
        const pending = waiting.indexOf(entry);
        if (pending >= 0) waiting.splice(pending, 1);
        reject(new Error(`等待 ${type} 消息超时`));
      }, timeout);
    });
  };
}

test("页面助手通过 CDP 按 viewport CSS 像素注入输入", async (t) => {
  const commands = [];
  const cdpServer = createServer();
  const targetWss = new WebSocketServer({ noServer: true });
  await new Promise((resolve) => cdpServer.listen(0, "127.0.0.1", resolve));
  const address = cdpServer.address();
  const cdpOrigin = `http://127.0.0.1:${address.port}`;
  const targetWs = `ws://127.0.0.1:${address.port}/devtools/page/test-target`;
  const portProbe = createServer();
  await new Promise((resolve) => portProbe.listen(0, "127.0.0.1", resolve));
  const companionPort = portProbe.address().port;
  await new Promise((resolve) => portProbe.close(resolve));

  cdpServer.on("request", (request, response) => {
    if (request.url === "/json/list") {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify([{ id: "test-target", type: "page", title: "Mutiny Test", url: "https://game.test/", webSocketDebuggerUrl: targetWs }]));
      return;
    }
    response.writeHead(404).end();
  });
  cdpServer.on("upgrade", (request, socket, head) => {
    if (request.url === "/devtools/page/test-target") targetWss.handleUpgrade(request, socket, head, (ws) => targetWss.emit("connection", ws));
    else socket.destroy();
  });
  targetWss.on("connection", (socket) => socket.on("message", (raw) => {
    const command = JSON.parse(raw.toString());
    commands.push(command);
    const result = command.method === "Runtime.evaluate"
      ? { result: { value: { width: 1000, height: 500 } } }
      : command.method === "Page.getLayoutMetrics"
        ? { cssLayoutViewport: { clientWidth: 800, clientHeight: 600 } }
        : {};
    socket.send(JSON.stringify({ id: command.id, result }));
  }));

  const companion = spawn(process.execPath, [fileURLToPath(new URL("../companion/server.mjs", import.meta.url)), "--arm", `--cdp=${cdpOrigin}`, `--port=${companionPort}`], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  t.after(() => {
    companion.kill("SIGTERM");
    targetWss.close();
    cdpServer.close();
  });

  const codeMatch = await waitForOutput(companion.stdout, /本次授权码：(\d{6})/);
  const client = new WebSocket(`ws://127.0.0.1:${companionPort}`);
  await new Promise((resolve, reject) => { client.once("open", resolve); client.once("error", reject); });
  t.after(() => client.close());
  const nextMessage = inbox(client);

  client.send(JSON.stringify({ type: "auth", code: codeMatch[1] }));
  assert.equal((await nextMessage("auth-ok")).protocol, "cdp-page-v5");
  const targets = await nextMessage("targets");
  assert.equal(targets.targets[0].id, "test-target");
  client.send(JSON.stringify({ type: "select-target", targetId: "test-target" }));
  await nextMessage("target-selected");
  client.send(JSON.stringify({ type: "pointer", x: 0.9, y: 0.9 }));
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(commands.filter((command) => command.method === "Input.dispatchMouseEvent" || command.method === "Input.dispatchKeyEvent").length, 0);
  client.send(JSON.stringify({ type: "start-calibration" }));
  await nextMessage("control-state");
  assert.equal((await nextMessage("calibration-state")).state, "point-1");
  client.send(JSON.stringify({ type: "pointer-down", x: 0.2, y: 0.3, button: 0, buttons: 1 }));
  assert.equal((await nextMessage("calibration-state")).state, "point-2");
  client.send(JSON.stringify({ type: "pointer-down", x: 0.8, y: 0.7, button: 0, buttons: 1 }));
  assert.equal((await nextMessage("calibration-state")).state, "complete");
  client.send(JSON.stringify({ type: "set-control", enabled: true }));
  assert.equal((await nextMessage("control-state")).enabled, true);
  client.send(JSON.stringify({ type: "set-turn", remote: true }));
  const turnState = await nextMessage("turn-state");
  assert.equal(turnState.remote, true);
  assert.equal(turnState.localInputLocked, true);

  client.send(JSON.stringify({ type: "pointer", x: 0.35, y: 0.4 }));
  client.send(JSON.stringify({ type: "pointer-down", x: 0.35, y: 0.4, button: 0, buttons: 1 }));
  client.send(JSON.stringify({ type: "pointer-up", x: 0.35, y: 0.4, button: 0, buttons: 0 }));
  client.send(JSON.stringify({ type: "key-down", key: "a", code: "KeyA" }));
  client.send(JSON.stringify({ type: "key-up", key: "a", code: "KeyA" }));
  await new Promise((resolve) => setTimeout(resolve, 150));

  const moved = commands.find((command) => command.params?.type === "mouseMoved");
  assert.ok(Math.abs(moved.params.x - 310) < 0.001);
  assert.ok(Math.abs(moved.params.y - 155) < 0.001);
  assert.equal(commands.filter((command) => command.method === "Input.dispatchMouseEvent").length, 3);
  assert.deepEqual(commands.filter((command) => command.method === "Input.dispatchKeyEvent").map((command) => command.params.type), ["keyDown", "keyUp"]);
  const evaluations = commands.filter((command) => command.method === "Runtime.evaluate").map((command) => command.params.expression);
  assert.ok(evaluations.some((expression) => expression.includes("guard.locked = true")));
  assert.ok(evaluations.some((expression) => expression.includes("remote = true")));
  assert.ok(evaluations.some((expression) => expression.includes("remote = false")));
  const inputLocks = commands.filter((command) => command.method === "Input.setIgnoreInputEvents").map((command) => command.params.ignore);
  assert.ok(inputLocks.includes(true));
  assert.ok(inputLocks.includes(false));
});
