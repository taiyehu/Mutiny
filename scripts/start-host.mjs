import { argument, assertNodeVersion, cdpReady, ensureBrowser, ensureDependencies, ensureEnvironment, findBrowser, flag, projectRoot, spawnNode, urlReady, waitForUrl } from "./launch-utils.mjs";

assertNodeVersion();
ensureEnvironment();
ensureDependencies();

const relayUrl = new URL(argument("relay-url", process.env.HOST_RELAY_URL || "http://localhost:3000/"));
const cdpPort = Number(argument("cdp-port", process.env.HOST_CDP_PORT || "9222"));
const companionPort = Number(argument("companion-port", process.env.HOST_COMPANION_PORT || "8765"));
const browserPath = findBrowser();
const checkOnly = flag("check");
const localRelay = ["localhost", "127.0.0.1", "[::1]"].includes(relayUrl.hostname);
const shouldStartDev = !flag("no-dev") && process.env.HOST_START_DEV !== "false" && localRelay;

if (![cdpPort, companionPort].every((port) => Number.isInteger(port) && port > 0 && port <= 65535)) {
  throw new Error("HOST_CDP_PORT 和 HOST_COMPANION_PORT 必须是有效端口。");
}

console.log(`房主页面：${relayUrl}`);
console.log(`浏览器：${browserPath}`);
if (checkOnly) {
  console.log(`环境检查完成；Chromium 调试端口当前${await cdpReady(cdpPort) ? "已启动" : "未启动"}。`);
  process.exit(0);
}

let devProcess = null;
if (!(await urlReady(relayUrl.href))) {
  if (!shouldStartDev) throw new Error(`房主页面不可访问：${relayUrl}`);
  console.log("正在启动网页与信令服务……");
  devProcess = spawnNode(["--env-file-if-exists=.env.local", "scripts/dev.mjs"]);
  await waitForUrl(relayUrl.href);
} else {
  console.log("网页已经运行，将直接复用。");
}

await ensureBrowser({ browserPath, cdpPort, urls: [relayUrl.href] });

console.log("\n正在启动 Chromium 页面控制助手……");
console.log("请把下面显示的 6 位授权码填入房主页面。\n");
const companion = spawnNode(["companion/server.mjs", "--arm", `--cdp=http://127.0.0.1:${cdpPort}`, `--port=${companionPort}`]);

let closing = false;
function shutdown(exitCode = 0) {
  if (closing) return;
  closing = true;
  companion.kill("SIGTERM");
  devProcess?.kill("SIGTERM");
  setTimeout(() => process.exit(exitCode), 250).unref();
}
companion.on("exit", (code) => shutdown(code || 0));
devProcess?.on("exit", (code) => { if (!closing && code) shutdown(code); });
process.on("SIGINT", () => shutdown());
process.on("SIGTERM", () => shutdown());

console.log(`运行目录：${projectRoot}`);
