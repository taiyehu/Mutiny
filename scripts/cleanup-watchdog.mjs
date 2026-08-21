import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { WebSocket } from "ws";

const parentPid = Number(process.argv.find((item) => item.startsWith("--parent="))?.slice(9));
const sessionArgument = process.argv.find((item) => item.startsWith("--session="))?.slice(10) || "";
const sessionDir = path.resolve(sessionArgument);
const cdpPort = Number(process.argv.find((item) => item.startsWith("--cdp="))?.slice(6));
const allowedPrefix = path.resolve(os.tmpdir(), "mutiny-relay-session-");

if (!Number.isInteger(parentPid) || parentPid <= 0 || !sessionDir.startsWith(allowedPrefix)) process.exit(2);

function alive(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

function terminateTree(pid) {
  if (!Number.isInteger(pid) || pid <= 0 || !alive(pid)) return;
  if (process.platform === "win32") {
    spawnSync("taskkill.exe", ["/pid", String(pid), "/t", "/f"], { stdio: "ignore", windowsHide: true });
  } else {
    try { process.kill(-pid, "SIGTERM"); } catch { try { process.kill(pid, "SIGTERM"); } catch { /* Process already exited. */ } }
  }
}

async function removeSessionDirectory() {
  if (!sessionDir.startsWith(allowedPrefix)) return;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      fs.rmSync(sessionDir, { recursive: true, force: true });
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
}

async function closeBrowserCdp() {
  if (!Number.isInteger(cdpPort) || cdpPort <= 0) return;
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

let cleaning = false;
async function cleanup() {
  if (cleaning) return;
  cleaning = true;
  await closeBrowserCdp();
  await new Promise((resolve) => setTimeout(resolve, 700));
  try {
    const pids = JSON.parse(fs.readFileSync(path.join(sessionDir, "pids.json"), "utf8"));
    for (const pid of [...pids].reverse()) terminateTree(pid);
  } catch { /* The parent may have completed its own cleanup. */ }
  await new Promise((resolve) => setTimeout(resolve, 500));
  await removeSessionDirectory();
  process.exit(0);
}

const timer = setInterval(() => {
  if (!fs.existsSync(sessionDir)) process.exit(0);
  if (!alive(parentPid)) void cleanup();
}, 750);
timer.unref();
process.stdin.resume();
