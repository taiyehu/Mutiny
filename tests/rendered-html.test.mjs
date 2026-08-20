import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

async function render(path = "/") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request(`http://localhost${path}`, { headers: { accept: "text/html", host: "localhost" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("服务端能够渲染 Mutiny Relay 首页", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  const html = await response.text();
  assert.match(html, /<title>Mutiny Relay — 远程同屏联机<\/title>/i);
  assert.match(html, /通用远程协作/);
  assert.match(html, /红蓝回合对战/);
  assert.doesNotMatch(html, /Your site is taking shape|Building your site/);
});

test("本地联机组件与配置齐全", async () => {
  const [home, page, freeRoute, turnsRoute, signal, companion, proxy, envExample, packageJson] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/relay-room.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/free/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/turns/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../server/signaling.mjs", import.meta.url), "utf8"),
    readFile(new URL("../companion/server.mjs", import.meta.url), "utf8"),
    readFile(new URL("../server/lan-proxy.mjs", import.meta.url), "utf8"),
    readFile(new URL("../.env.example", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);
  assert.match(home, /href="\/free"/);
  assert.match(home, /href="\/turns"/);
  assert.match(freeRoute, /mode="free"/);
  assert.match(turnsRoute, /mode="turns"/);
  assert.match(page, /NEXT_PUBLIC_SIGNAL_URL/);
  assert.match(page, /getDisplayMedia/);
  assert.match(page, /approve-peer/);
  assert.match(page, /getStats/);
  assert.match(signal, /new WebSocketServer/);
  assert.match(signal, /roomCode/);
  assert.match(signal, /generate-ice-servers/);
  assert.match(signal, /get-ice-servers/);
  assert.match(signal, /pass-control/);
  assert.match(signal, /reclaim-control/);
  assert.match(signal, /controlLeaseMs/);
  assert.match(signal, /turnDurationMs/);
  assert.match(signal, /socket\.ping/);
  assert.match(companion, /127\.0\.0\.1/);
  assert.match(companion, /--arm/);
  assert.match(companion, /Page\.getLayoutMetrics/);
  assert.match(companion, /Input\.dispatchMouseEvent/);
  assert.match(companion, /Input\.dispatchKeyEvent/);
  assert.match(proxy, /PUBLIC_HTTP_PORT/);
  assert.match(page, /window\.location\.port === "3000"/);
  assert.match(page, /ws:\/\/127\.0\.0\.1:8787/);
  assert.match(page, /选择目标标签页/);
  assert.match(page, /TURN 已就绪/);
  assert.match(page, /结束蓝方回合/);
  assert.match(page, /turnSecondsLeft/);
  assert.match(page, /本回合剩余时间/);
  assert.match(page, /开始两点校准/);
  assert.match(page, /重新开始校准/);
  assert.match(page, /重新校准坐标/);
  assert.match(page, /取消校准/);
  assert.match(page, /重新连接/);
  assert.match(signal, /reset-control-session/);
  assert.match(signal, /reload-session-ready/);
  assert.match(page, /媒体与控制连接已停止/);
  assert.match(companion, /setLocalInputLocked/);
  assert.match(envExample, /NEXT_PUBLIC_TURN_URLS/);
  assert.match(packageJson, /server\/signaling\.mjs/);
  assert.match(packageJson, /"companion:arm": "node companion\/server\.mjs --arm"/);
  await assert.rejects(access(new URL("../companion/windows-input.ps1", import.meta.url)));
  await assert.rejects(access(new URL("app/_sites-preview/SkeletonPreview.tsx", root)));
});
