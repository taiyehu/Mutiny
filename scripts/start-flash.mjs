import fs from "node:fs";
import path from "node:path";
import { argument, assertNodeVersion, ensureBrowser, ensureDependencies, findBrowser, flag, projectRoot, spawnNode, urlReady, waitForUrl } from "./launch-utils.mjs";

assertNodeVersion();
ensureDependencies();

const playerUrl = new URL(argument("player-url", process.env.HOST_PLAYER_URL || "http://127.0.0.1:8790/"));
const cdpPort = Number(argument("cdp-port", process.env.HOST_CDP_PORT || "9222"));
const browserPath = findBrowser();
const swfPath = path.join(projectRoot, "mutiny.swf");

if (!fs.existsSync(swfPath)) throw new Error(`找不到 ${swfPath}。请先把已获许可的 mutiny.swf 放到项目根目录。`);
if (flag("check")) {
  console.log(`Flash 启动环境检查完成：${playerUrl}`);
  process.exit(0);
}

let player = null;
if (!(await urlReady(playerUrl.href))) {
  console.log("正在启动 Ruffle Flash 播放器……");
  player = spawnNode(["scripts/mutiny-local.mjs"]);
  await waitForUrl(playerUrl.href, 20_000);
} else {
  console.log("Flash 播放器已经运行，将直接复用。");
}

await ensureBrowser({ browserPath, cdpPort, urls: [playerUrl.href] });
console.log(`Flash 已打开：${playerUrl}`);
console.log("按 Ctrl+C 停止本次启动的播放器；Chromium 窗口会保留。\n");

if (!player) process.exit(0);
let closing = false;
function shutdown() {
  if (closing) return;
  closing = true;
  player.kill("SIGTERM");
  setTimeout(() => process.exit(0), 200).unref();
}
player.on("exit", (code) => { if (!closing) process.exit(code || 0); });
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
