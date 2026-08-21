import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function argument(name, fallback) {
  const prefix = `--${name}=`;
  return process.argv.find((item) => item.startsWith(prefix))?.slice(prefix.length) || fallback;
}

export function flag(name) {
  return process.argv.includes(`--${name}`);
}

export function ensureEnvironment() {
  const target = path.join(projectRoot, ".env.local");
  if (fs.existsSync(target)) return false;
  fs.copyFileSync(path.join(projectRoot, ".env.example"), target, fs.constants.COPYFILE_EXCL);
  console.log("已根据 .env.example 创建 .env.local；现有配置以后不会被启动脚本覆盖。");
  return true;
}

export function ensureDependencies() {
  if (fs.existsSync(path.join(projectRoot, "node_modules", "vinext"))) return;
  console.log("首次运行：正在安装项目依赖……");
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  const result = spawnSync(npm, ["ci"], { cwd: projectRoot, stdio: "inherit" });
  if (result.status !== 0) throw new Error("npm ci 失败，请检查网络和 Node.js 环境。");
}

export function assertNodeVersion() {
  const [major, minor] = process.versions.node.split(".").map(Number);
  if (major < 22 || (major === 22 && minor < 13)) {
    throw new Error(`需要 Node.js 22.13.0 或更高版本，当前为 ${process.version}。`);
  }
}

function candidates() {
  const configured = process.env.HOST_BROWSER_PATH;
  if (configured) return [configured];
  if (process.platform === "win32") {
    const programFiles = process.env.ProgramFiles || "C:\\Program Files";
    const programFilesX86 = process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";
    const localAppData = process.env.LOCALAPPDATA || "";
    return [
      path.join(programFiles, "Google", "Chrome", "Application", "chrome.exe"),
      path.join(programFilesX86, "Microsoft", "Edge", "Application", "msedge.exe"),
      path.join(localAppData, "Google", "Chrome", "Application", "chrome.exe"),
      path.join(programFiles, "Microsoft", "Edge", "Application", "msedge.exe"),
    ];
  }
  if (process.platform === "darwin") {
    return [
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
    ];
  }
  return ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "microsoft-edge"];
}

function executableOnPath(command) {
  const checker = process.platform === "win32" ? "where.exe" : "which";
  return spawnSync(checker, [command], { stdio: "ignore" }).status === 0;
}

export function findBrowser() {
  for (const candidate of candidates()) {
    if (path.isAbsolute(candidate) ? fs.existsSync(candidate) : executableOnPath(candidate)) return candidate;
  }
  throw new Error("未找到 Chrome、Edge 或 Chromium。可在 .env.local 中设置 HOST_BROWSER_PATH=浏览器完整路径。");
}

export async function urlReady(url, timeoutMs = 1200) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), cache: "no-store" });
    return response.ok;
  } catch {
    return false;
  }
}

export async function waitForUrl(url, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await urlReady(url)) return;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`等待服务启动超时：${url}`);
}

export async function cdpReady(port) {
  return urlReady(`http://127.0.0.1:${port}/json/version`);
}

export async function openCdpTab(port, url) {
  const endpoint = `http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`;
  const response = await fetch(endpoint, { method: "PUT", signal: AbortSignal.timeout(3000) });
  if (!response.ok) throw new Error(`Chromium 无法打开标签页：HTTP ${response.status}`);
}

export async function ensureBrowser({ browserPath, cdpPort, urls = [] }) {
  if (await cdpReady(cdpPort)) {
    for (const url of urls) await openCdpTab(cdpPort, url);
    console.log(`已复用本机 Chromium 调试实例（CDP ${cdpPort}）。`);
    return null;
  }
  const profile = process.env.HOST_BROWSER_PROFILE || path.join(os.tmpdir(), "mutiny-relay-cdp-profile");
  const args = [
    `--remote-debugging-port=${cdpPort}`,
    "--remote-debugging-address=127.0.0.1",
    `--user-data-dir=${profile}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--new-window",
    ...urls,
  ];
  const child = spawn(browserPath, args, { cwd: projectRoot, detached: process.platform !== "win32", stdio: "ignore", windowsHide: false });
  child.unref();
  await waitForUrl(`http://127.0.0.1:${cdpPort}/json/version`, 15_000);
  console.log(`已启动独立 Chromium（CDP ${cdpPort}，仅监听本机）。`);
  return child;
}

export function spawnNode(args, options = {}) {
  return spawn(process.execPath, args, { cwd: projectRoot, env: process.env, stdio: "inherit", ...options });
}
