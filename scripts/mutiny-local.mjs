import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extractInnerSwf, inspectSwf } from "./extract-inner-swf.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const inputPath = path.join(projectRoot, "mutiny.swf");
const outputPath = path.join(projectRoot, "local-player", "mutiny-game.swf");
const patchedPath = path.join(projectRoot, "local-player", "mutiny-game-local.swf");
const pagePath = path.join(projectRoot, "local-player", "index.html");
const ruffleRoot = path.join(projectRoot, "node_modules", "@ruffle-rs", "ruffle");
const host = "127.0.0.1";
const port = Number(process.env.LOCAL_PLAYER_PORT || 8790);

if (!fs.existsSync(inputPath)) throw new Error(`找不到 ${inputPath}`);
if (!fs.existsSync(outputPath) || fs.statSync(outputPath).mtimeMs < fs.statSync(inputPath).mtimeMs) {
  extractInnerSwf(inputPath, outputPath);
}
const gamePath = fs.existsSync(patchedPath) && fs.statSync(patchedPath).mtimeMs >= fs.statSync(outputPath).mtimeMs
  ? patchedPath
  : outputPath;
const metadata = inspectSwf(fs.readFileSync(gamePath));

function sendFile(response, filePath, contentType, cache = false) {
  response.writeHead(200, {
    "content-type": contentType,
    "content-length": fs.statSync(filePath).size,
    "cache-control": cache ? "public, max-age=31536000, immutable" : "no-store",
    "cross-origin-resource-policy": "same-origin",
  });
  fs.createReadStream(filePath).pipe(response);
}

const server = http.createServer((request, response) => {
  response.setHeader("cross-origin-opener-policy", "same-origin");
  response.setHeader("cross-origin-embedder-policy", "require-corp");
  const url = new URL(request.url || "/", `http://${host}:${port}`);
  if (url.pathname === "/" || url.pathname === "/index.html") {
    const html = fs.readFileSync(pagePath, "utf8")
      .replaceAll("__GAME_WIDTH__", String(metadata.width))
      .replaceAll("__GAME_HEIGHT__", String(metadata.height))
      .replaceAll("__GAME_VARIANT__", gamePath === patchedPath ? "本地许可补丁版" : "未修改原版")
      .replaceAll("__LICENSE_NOTE__", gamePath === patchedPath
        ? "已加载经许可的本地补丁版；原始 SWF 未被覆盖。"
        : "若游戏显示 “URL-Locked”，请先在取得修改许可后运行 npm run mutiny:patch。");
    response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    return response.end(html);
  }
  if (url.pathname === "/mutiny-game.swf") return sendFile(response, gamePath, "application/x-shockwave-flash");
  if (url.pathname.startsWith("/ruffle/")) {
    const name = path.basename(url.pathname);
    const filePath = path.join(ruffleRoot, name);
    if (!filePath.startsWith(ruffleRoot + path.sep) || !fs.existsSync(filePath)) {
      response.writeHead(404); return response.end("Not found");
    }
    const type = name.endsWith(".wasm") ? "application/wasm" : name.endsWith(".map") ? "application/json" : "text/javascript; charset=utf-8";
    return sendFile(response, filePath, type, true);
  }
  response.writeHead(404); response.end("Not found");
});

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.error(`无法启动：本机端口 ${port} 已被占用。`);
    console.error(`请先尝试打开 http://${host}:${port}/；如果看到 Mutiny 页面，说明播放器已经在运行。`);
    console.error(`也可以在 PowerShell 中换端口运行：$env:LOCAL_PLAYER_PORT=${port + 1}; npm run mutiny:local`);
    process.exitCode = 1;
    return;
  }
  throw error;
});

server.listen(port, host, () => {
  console.log(`Mutiny 纯本地播放器：http://${host}:${port}/`);
  console.log(`内层游戏：SWF v${metadata.version}，${metadata.width} × ${metadata.height}，${metadata.frameRate} fps`);
  console.log(`版本：${gamePath === patchedPath ? "本地许可补丁版" : "未修改原版"}`);
  console.log("按 Ctrl+C 停止。本服务只监听 127.0.0.1。\n");
});

process.on("SIGINT", () => server.close(() => process.exit(0)));
process.on("SIGTERM", () => server.close(() => process.exit(0)));
