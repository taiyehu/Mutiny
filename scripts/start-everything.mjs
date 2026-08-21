import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { WebSocket } from "ws";
import { argument, assertNodeVersion, ensureDependencies, ensureEnvironment, findBrowser, projectRoot, spawnNode, urlReady, waitForUrl } from "./launch-utils.mjs";

assertNodeVersion();
ensureEnvironment();
ensureDependencies();

const relayUrl = new URL(argument("relay-url", process.env.HOST_RELAY_URL || "http://localhost:3000/"));
const cdpPort = Number(argument("cdp-port", process.env.HOST_CDP_PORT || "9222"));
const companionPort = Number(argument("companion-port", process.env.HOST_COMPANION_PORT || "8765"));
const localRelay = ["localhost", "127.0.0.1", "[::1]"].includes(relayUrl.hostname);
const startDev = process.env.HOST_START_DEV !== "false" && localRelay;
const sessionDir = fs.mkdtempSync(path.join(os.tmpdir(), "mutiny-relay-session-"));
const profileDir = path.join(sessionDir, "chromium-profile");
const pidFile = path.join(sessionDir, "pids.json");
const children = [];
let closing = false;

function savePids() {
  fs.writeFileSync(pidFile, JSON.stringify(children.map((child) => child.pid).filter(Number.isInteger)));
}

function owned(child, label, { fatalExit = true } = {}) {
  children.push(child);
  savePids();
  child.once("exit", (code) => {
    if (!closing && fatalExit && code) void shutdown(code, `${label} 异常退出`);
  });
  return child;
}

async function closeBrowserCdp() {
  try {
    const response = await fetch(`http://127.0.0.1:${cdpPort}/json/version`, { signal: AbortSignal.timeout(1500) });
    const { webSocketDebuggerUrl } = await response.json();
    if (!webSocketDebuggerUrl) return;
    await new Promise((resolve) => {
      const socket = new WebSocket(webSocketDebuggerUrl);
      const timer = setTimeout(() => { socket.terminate(); resolve(); }, 2500);
      const finish = () => { clearTimeout(timer); resolve(); };
      socket.once("open", () => socket.send(JSON.stringify({ id: 1, method: "Browser.close" })));
      socket.once("close", finish);
      socket.once("error", finish);
    });
  } catch { /* Chromium may already be closed. */ }
}

function terminateTree(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return;
  if (process.platform === "win32") {
    spawnSync("taskkill.exe", ["/pid", String(pid), "/t", "/f"], { stdio: "ignore", windowsHide: true });
  } else {
    try { process.kill(-pid, "SIGTERM"); } catch { try { process.kill(pid, "SIGTERM"); } catch { /* Process already exited. */ } }
  }
}

async function removeSessionDirectory() {
  if (!sessionDir.startsWith(path.resolve(os.tmpdir(), "mutiny-relay-session-"))) return true;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      fs.rmSync(sessionDir, { recursive: true, force: true });
      return true;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  return false;
}

async function shutdown(code = 0, reason = "正在关闭全部相关进程") {
  if (closing) return;
  closing = true;
  console.log(`\n${reason}……`);
  await closeBrowserCdp();
  await new Promise((resolve) => setTimeout(resolve, 700));
  for (const child of [...children].reverse()) terminateTree(child.pid);
  await new Promise((resolve) => setTimeout(resolve, 500));
  if (!(await removeSessionDirectory())) console.warn(`临时浏览器目录仍被系统占用，可稍后手动删除：${sessionDir}`);
  console.log("网页/信令、companion 和专用 Chromium 已全部结束。\n");
  process.exit(code);
}

function portFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.listen(port, "127.0.0.1", () => server.close(() => resolve(true)));
  });
}

async function requireFree(port, name) {
  if (!(await portFree(port))) throw new Error(`${name}端口 ${port} 已被其他程序占用。为避免误杀现有进程，请先关闭它再重试。`);
}

function findOrInstallBrowser() {
  try {
    return findBrowser();
  } catch (originalError) {
    if (process.platform !== "win32" || spawnSync("where.exe", ["winget.exe"], { stdio: "ignore" }).status !== 0) throw originalError;
    console.log("未找到 Chromium 浏览器，正在通过 winget 安装 Microsoft Edge……");
    const result = spawnSync("winget.exe", ["install", "--id", "Microsoft.Edge", "--exact", "--accept-package-agreements", "--accept-source-agreements"], { stdio: "inherit" });
    if (result.status !== 0) throw new Error("浏览器安装失败。请手动安装 Chrome、Edge 或 Chromium 后重试。");
    return findBrowser();
  }
}

async function main() {
  const browserPath = findOrInstallBrowser();
  await requireFree(cdpPort, "Chromium 调试");
  await requireFree(companionPort, "companion");
  if (startDev) {
    await requireFree(Number(process.env.SIGNAL_PORT || 8787), "信令");
    await requireFree(3000, "网页");
  } else if (!(await urlReady(relayUrl.href, 5000))) {
    throw new Error(`公网房主页面不可访问：${relayUrl}`);
  }

  const watchdog = spawn(process.execPath, ["scripts/cleanup-watchdog.mjs", `--parent=${process.pid}`, `--session=${sessionDir}`, `--cdp=${cdpPort}`], {
    cwd: projectRoot, detached: true, stdio: "ignore", windowsHide: true,
  });
  watchdog.unref();

  if (startDev) {
    console.log("[1/3] 启动本地网页与信令服务");
    owned(spawnNode(["--env-file-if-exists=.env.local", "scripts/dev.mjs"], { detached: process.platform !== "win32" }), "网页与信令");
    await waitForUrl(relayUrl.href, 30_000);
  } else {
    console.log(`[1/3] 使用公网房主页面：${relayUrl}`);
  }

  console.log("[2/3] 启动专用 Chromium");
  fs.mkdirSync(profileDir, { recursive: true });
  const browser = owned(spawn(browserPath, [
    `--remote-debugging-port=${cdpPort}`,
    "--remote-debugging-address=127.0.0.1",
    `--user-data-dir=${profileDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--new-window",
    relayUrl.href,
  ], { cwd: projectRoot, detached: process.platform !== "win32", stdio: "ignore", windowsHide: false }), "Chromium", { fatalExit: false });
  await waitForUrl(`http://127.0.0.1:${cdpPort}/json/version`, 15_000);
  if (!browser.pid) throw new Error("Chromium 启动失败。");

  console.log("[3/3] 启动 companion");
  console.log("请把下面显示的 6 位授权码填入房主页面。\n");
  owned(spawnNode(["companion/server.mjs", "--arm", `--cdp=http://127.0.0.1:${cdpPort}`, `--port=${companionPort}`], { detached: process.platform !== "win32" }), "companion");
  console.log("\n通用远程操控环境已就绪。按 Ctrl+C 可结束本脚本创建的全部进程。");
}

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
process.on("uncaughtException", (error) => { console.error(error.message); void shutdown(1, "启动失败，正在回收已启动进程"); });
process.on("unhandledRejection", (error) => { console.error(error); void shutdown(1, "启动失败，正在回收已启动进程"); });

try {
  await main();
} catch (error) {
  console.error(error.message);
  await shutdown(1, "启动失败，正在回收已启动进程");
}
