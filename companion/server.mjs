import crypto from "node:crypto";
import { WebSocketServer, WebSocket } from "ws";

if (!process.argv.includes("--arm")) {
  console.log("浏览器控制助手未启动。确认要允许远程输入后，请运行：npm run companion:arm");
  process.exit(0);
}

const cdpArgument = process.argv.find((argument) => argument.startsWith("--cdp="));
const cdpBase = new URL(cdpArgument?.slice("--cdp=".length) || "http://127.0.0.1:9222");
const portArgument = process.argv.find((argument) => argument.startsWith("--port="));
const companionPort = Number(portArgument?.slice("--port=".length) || 8765);
if (!["127.0.0.1", "localhost", "[::1]"].includes(cdpBase.hostname)) {
  console.error("为避免把浏览器调试接口暴露到网络，--cdp 只允许使用本机地址。");
  process.exit(1);
}

const code = String(crypto.randomInt(100000, 1000000));
if (!Number.isInteger(companionPort) || companionPort < 1 || companionPort > 65535) {
  console.error("--port 必须是 1 到 65535 之间的整数。");
  process.exit(1);
}
const wss = new WebSocketServer({ host: "127.0.0.1", port: companionPort });
let controller = null;
let target = null;
let calibration = null;
let coordinateMap = { scaleX: 1, scaleY: 1, offsetX: 0, offsetY: 0 };

function reply(socket, message) {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

async function listTargets() {
  const response = await fetch(new URL("/json/list", cdpBase));
  if (!response.ok) throw new Error(`CDP 返回 HTTP ${response.status}`);
  const entries = await response.json();
  return entries
    .filter((entry) => entry.type === "page" && entry.webSocketDebuggerUrl)
    .map(({ id, title, url, webSocketDebuggerUrl }) => ({ id, title, url, webSocketDebuggerUrl }));
}

class CdpTarget {
  constructor(info) {
    this.info = info;
    this.nextId = 1;
    this.pending = new Map();
    this.viewport = null;
    this.viewportAt = 0;
    this.localInputLocked = false;
    this.socket = new WebSocket(info.webSocketDebuggerUrl);
    this.ready = new Promise((resolve, reject) => {
      this.socket.once("open", resolve);
      this.socket.once("error", reject);
    });
    this.socket.on("message", (raw) => {
      const message = JSON.parse(raw.toString());
      if (!message.id) return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result);
    });
    this.socket.on("close", () => {
      for (const pending of this.pending.values()) pending.reject(new Error("目标页面已关闭"));
      this.pending.clear();
      if (target === this) {
        target = null;
        calibration = null;
        reply(controller, { type: "target-closed" });
      }
    });
  }

  async send(method, params = {}) {
    await this.ready;
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async getViewport() {
    if (this.viewport && Date.now() - this.viewportAt < 250) return this.viewport;
    const evaluated = await this.send("Runtime.evaluate", {
      expression: "({ width: window.innerWidth, height: window.innerHeight })",
      returnByValue: true,
    });
    const value = evaluated.result?.value;
    if (value?.width > 0 && value?.height > 0) {
      this.viewport = { width: value.width, height: value.height };
    } else {
      const metrics = await this.send("Page.getLayoutMetrics");
      const viewport = metrics.cssLayoutViewport;
      this.viewport = { width: viewport.clientWidth, height: viewport.clientHeight };
    }
    this.viewportAt = Date.now();
    return this.viewport;
  }

  async setLocalInputLocked(locked) {
    this.localInputLocked = Boolean(locked);
    await this.send("Input.setIgnoreInputEvents", { ignore: this.localInputLocked });
    await this.send("Runtime.evaluate", {
      expression: `(() => {
        const key = "__mutinyRelayInputGuard";
        let guard = window[key];
        if (!guard) {
          guard = { locked: false, remote: false };
          const block = (event) => {
            if (!guard.locked || guard.remote) return;
            event.preventDefault();
            event.stopImmediatePropagation();
          };
          ["pointerdown", "pointerup", "pointermove", "mousedown", "mouseup", "mousemove", "click", "dblclick", "contextmenu", "wheel", "keydown", "keyup", "keypress"].forEach((type) => {
            window.addEventListener(type, block, { capture: true, passive: false });
          });
          window[key] = guard;
        }
        guard.locked = ${Boolean(locked)};
        guard.remote = false;
      })()`,
    });
  }

  async setRemoteDispatch(active) {
    if (active) {
      await this.send("Runtime.evaluate", {
        expression: "window.__mutinyRelayInputGuard && (window.__mutinyRelayInputGuard.remote = true)",
      });
      if (this.localInputLocked) await this.send("Input.setIgnoreInputEvents", { ignore: false });
      return;
    }
    if (this.localInputLocked) await this.send("Input.setIgnoreInputEvents", { ignore: true });
    await this.send("Runtime.evaluate", {
      expression: "window.__mutinyRelayInputGuard && (window.__mutinyRelayInputGuard.remote = false)",
    });
  }

  close() {
    this.socket.close();
  }
}

async function releaseTarget(instance) {
  if (!instance) return;
  try { await instance.setLocalInputLocked(false); } catch { /* A closing target may no longer accept CDP commands. */ }
  instance.close();
}

function modifierMask(message) {
  return (message.altKey ? 1 : 0) | (message.ctrlKey ? 2 : 0) |
    (message.metaKey ? 4 : 0) | (message.shiftKey ? 8 : 0);
}

function virtualKey(key) {
  const named = {
    Backspace: 8, Tab: 9, Enter: 13, Shift: 16, Control: 17, Alt: 18,
    Escape: 27, " ": 32, PageUp: 33, PageDown: 34, End: 35, Home: 36,
    ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40, Delete: 46,
  };
  if (named[key]) return named[key];
  if (key.length === 1) return key.toUpperCase().charCodeAt(0);
  const functionKey = /^F([1-9]|1[0-2])$/.exec(key);
  return functionKey ? 111 + Number(functionKey[1]) : 0;
}

async function dispatchInput(message) {
  if (!target) throw new Error("尚未选择目标页面");
  await target.setRemoteDispatch(true);
  try {
    if (["pointer", "pointer-down", "pointer-up", "click"].includes(message.type)) {
    const viewport = await target.getViewport();
    const normalizedX = Number(message.x) * coordinateMap.scaleX + coordinateMap.offsetX;
    const normalizedY = Number(message.y) * coordinateMap.scaleY + coordinateMap.offsetY;
    const x = Math.max(0, Math.min(viewport.width - 1, normalizedX * viewport.width));
    const y = Math.max(0, Math.min(viewport.height - 1, normalizedY * viewport.height));
    if (message.type === "pointer") {
      await target.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, button: "none", buttons: Number(message.buttons) || 0 });
    } else {
      const button = ["left", "middle", "right"][Number(message.button) || 0] || "left";
      if (message.type === "click" || message.type === "pointer-down") {
        await target.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button, buttons: Number(message.buttons) || (button === "left" ? 1 : button === "right" ? 2 : 4), clickCount: 1 });
      }
      if (message.type === "click" || message.type === "pointer-up") {
        await target.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button, buttons: Number(message.buttons) || 0, clickCount: 1 });
      }
    }
      return;
    }
    if (["key", "key-down", "key-up"].includes(message.type)) {
    const key = String(message.key || "");
    if (!key) return;
    const modifiers = modifierMask(message);
    const keyCode = virtualKey(key);
    const printable = key.length === 1 && !(message.ctrlKey || message.altKey || message.metaKey);
    const common = {
      key,
      code: String(message.code || ""),
      modifiers,
      windowsVirtualKeyCode: keyCode,
      nativeVirtualKeyCode: keyCode,
      isKeypad: String(message.code || "").startsWith("Numpad"),
      autoRepeat: Boolean(message.repeat),
    };
    if (message.type === "key" || message.type === "key-down") {
      await target.send("Input.dispatchKeyEvent", {
        type: "keyDown",
        ...common,
        ...(printable ? { text: key, unmodifiedText: key } : {}),
      });
    }
    if (message.type === "key" || message.type === "key-up") {
      await target.send("Input.dispatchKeyEvent", { type: "keyUp", ...common });
    }
    }
  } finally {
    await target?.setRemoteDispatch(false);
  }
}

const calibrationPoints = [{ x: 0.12, y: 0.12 }, { x: 0.88, y: 0.88 }];

async function showCalibrationPoint(index) {
  const point = calibrationPoints[index];
  const label = index === 0 ? "1 / 2" : "2 / 2";
  await target.send("Runtime.evaluate", {
    expression: `(() => {
      const id = "mutiny-relay-calibration";
      let marker = document.getElementById(id);
      if (!marker) {
        marker = document.createElement("div");
        marker.id = id;
        document.documentElement.appendChild(marker);
      }
      Object.assign(marker.style, {
        position: "fixed", zIndex: "2147483647", left: "${point.x * 100}%", top: "${point.y * 100}%",
        width: "52px", height: "52px", transform: "translate(-50%, -50%)", borderRadius: "50%",
        border: "5px solid #fff", background: "#ef684b", boxShadow: "0 0 0 5px #17231f, 0 0 32px rgba(0,0,0,.65)",
        color: "#fff", display: "grid", placeItems: "center", font: "900 14px monospace",
        pointerEvents: "none", userSelect: "none"
      });
      marker.textContent = "${label}";
    })()`,
  });
}

async function removeCalibrationPoint() {
  if (!target) return;
  await target.send("Runtime.evaluate", {
    expression: "document.getElementById('mutiny-relay-calibration')?.remove()",
  });
}

async function handleCalibration(message, socket) {
  if (!calibration || message.type !== "pointer-down") return;
  calibration.samples.push({ x: Number(message.x), y: Number(message.y) });
  if (calibration.samples.length === 1) {
    await showCalibrationPoint(1);
    reply(socket, { type: "calibration-state", state: "point-2" });
    return;
  }
  const [first, second] = calibration.samples;
  const dx = second.x - first.x;
  const dy = second.y - first.y;
  if (Math.abs(dx) < 0.2 || Math.abs(dy) < 0.2) {
    calibration = { samples: [] };
    await showCalibrationPoint(0);
    reply(socket, { type: "calibration-state", state: "point-1", message: "两次点击距离太近，请重新点击第一个定位点。" });
    return;
  }
  coordinateMap = {
    scaleX: (calibrationPoints[1].x - calibrationPoints[0].x) / dx,
    scaleY: (calibrationPoints[1].y - calibrationPoints[0].y) / dy,
    offsetX: calibrationPoints[0].x - ((calibrationPoints[1].x - calibrationPoints[0].x) / dx) * first.x,
    offsetY: calibrationPoints[0].y - ((calibrationPoints[1].y - calibrationPoints[0].y) / dy) * first.y,
  };
  calibration = null;
  await removeCalibrationPoint();
  await target.setLocalInputLocked(false);
  reply(socket, { type: "calibration-state", state: "complete", map: coordinateMap });
}

async function sendTargets(socket) {
  try {
    const entries = await listTargets();
    reply(socket, { type: "targets", targets: entries.map((entry) => ({ id: entry.id, title: entry.title, url: entry.url })) });
  } catch (error) {
    reply(socket, { type: "cdp-error", message: `无法连接 Chromium 调试端口：${error.message}` });
  }
}

wss.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.error(`浏览器控制助手无法启动：127.0.0.1:${companionPort} 已被占用。请先关闭之前运行助手的终端，然后重试。`);
  } else {
    console.error(`浏览器控制助手启动失败：${error.message}`);
  }
  process.exitCode = 1;
});

wss.on("connection", (socket) => {
  let authenticated = false;
  let armed = false;
  let remoteTurn = false;
  let inputQueue = Promise.resolve();
  socket.on("message", async (raw) => {
    let message;
    try { message = JSON.parse(raw.toString()); } catch { return; }
    if (!authenticated) {
      if (message.type !== "auth" || String(message.code) !== code) {
        reply(socket, { type: "auth-error" });
        return socket.close(4003, "invalid code");
      }
      if (controller && controller !== socket) controller.close(4004, "replaced");
      const previousTarget = target;
      target = null;
      calibration = null;
      coordinateMap = { scaleX: 1, scaleY: 1, offsetX: 0, offsetY: 0 };
      void releaseTarget(previousTarget);
      controller = socket;
      authenticated = true;
      reply(socket, { type: "auth-ok", protocol: "cdp-page-v5" });
      await sendTargets(socket);
      console.log("房主页面已连接。请选择目标标签页；按 Ctrl+C 可立即停止。");
      return;
    }
    try {
      if (message.type === "refresh-targets") return await sendTargets(socket);
      if (message.type === "select-target") {
        const entries = await listTargets();
        const selected = entries.find((entry) => entry.id === message.targetId);
        if (!selected) throw new Error("目标页面不存在，请刷新列表");
        armed = false;
        calibration = null;
        coordinateMap = { scaleX: 1, scaleY: 1, offsetX: 0, offsetY: 0 };
        const previousTarget = target;
        target = null;
        void releaseTarget(previousTarget);
        const nextTarget = new CdpTarget(selected);
        await nextTarget.ready;
        const viewport = await nextTarget.getViewport();
        target = nextTarget;
        await target.setLocalInputLocked(false);
        reply(socket, { type: "target-selected", target: { id: selected.id, title: selected.title, url: selected.url }, viewport });
        console.log(`已锁定目标标签页：${selected.title} (${selected.url})`);
        return;
      }
      if (message.type === "set-control") {
        if (message.enabled && !target) throw new Error("尚未选择目标页面");
        armed = Boolean(message.enabled);
        await target?.setLocalInputLocked(Boolean(calibration) || (armed && remoteTurn));
        reply(socket, { type: "control-state", enabled: armed });
        return;
      }
      if (message.type === "set-turn") {
        remoteTurn = Boolean(message.remote);
        await target?.setLocalInputLocked(Boolean(calibration) || (armed && remoteTurn));
        reply(socket, { type: "turn-state", remote: remoteTurn, localInputLocked: Boolean(target && (calibration || (armed && remoteTurn))) });
        return;
      }
      if (message.type === "start-calibration") {
        if (!target) throw new Error("尚未选择目标页面");
        armed = false;
        calibration = { samples: [] };
        await target.setLocalInputLocked(true);
        coordinateMap = { scaleX: 1, scaleY: 1, offsetX: 0, offsetY: 0 };
        reply(socket, { type: "control-state", enabled: false });
        await showCalibrationPoint(0);
        reply(socket, { type: "calibration-state", state: "point-1" });
        return;
      }
      if (message.type === "cancel-calibration") {
        calibration = null;
        await removeCalibrationPoint();
        await target?.setLocalInputLocked(armed && remoteTurn);
        reply(socket, { type: "calibration-state", state: "off" });
        return;
      }
      if (["pointer", "pointer-down", "pointer-up", "click", "key", "key-down", "key-up"].includes(message.type)) {
        inputQueue = inputQueue.catch(() => {}).then(async () => {
          if (calibration) await handleCalibration(message, socket);
          else if (armed) await dispatchInput(message);
        });
        await inputQueue;
      }
    } catch (error) {
      if (calibration) {
        calibration = null;
        try { await removeCalibrationPoint(); } catch { /* The original error is more useful. */ }
        try { await target?.setLocalInputLocked(false); } catch { /* Keep the original error. */ }
        reply(socket, { type: "calibration-state", state: "off" });
      }
      reply(socket, { type: "input-error", message: error.message });
    }
  });
  socket.on("close", () => {
    if (controller === socket) {
      controller = null;
      const previousTarget = target;
      target = null;
      calibration = null;
      void releaseTarget(previousTarget);
    }
  });
});

async function shutdown() {
  const previousTarget = target;
  target = null;
  await releaseTarget(previousTarget);
  for (const socket of wss.clients) socket.close();
  wss.close();
  process.exit(0);
}
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());

let announced = false;
function announce() {
  if (announced) return;
  announced = true;
  console.log("\nMutiny Relay Chromium 页面控制助手已启动");
  console.log(`控制入口仅监听：ws://127.0.0.1:${companionPort}`);
  console.log(`Chromium 调试接口：${cdpBase.origin}`);
  console.log(`本次授权码：${code}`);
  console.log("它不会移动系统鼠标，只会向你在房主页面中选定的标签页发送 CDP 输入事件。\n");
}
wss.on("listening", announce);
if (wss.address()) queueMicrotask(announce);
