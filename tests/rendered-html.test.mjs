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
  assert.match(html, /进入远程协作/);
  assert.doesNotMatch(html, /红蓝|红方|蓝方|回合对战/);
  assert.doesNotMatch(html, /Your site is taking shape|Building your site/);
});

test("本地联机组件与配置齐全", async () => {
  const [layout, home, page, styles, freeRoute, signal, companion, nativeHost, proxy, hostLauncher, flashLauncher, lazyLauncher, watchdog, envExample, packageJson, hostCommand, localTestCommand, flashCommand] = await Promise.all([
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/relay-room.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../app/free/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../server/signaling.mjs", import.meta.url), "utf8"),
    readFile(new URL("../companion/server.mjs", import.meta.url), "utf8"),
    readFile(new URL("../companion/windows-native-host.ps1", import.meta.url), "utf8"),
    readFile(new URL("../server/lan-proxy.mjs", import.meta.url), "utf8"),
    readFile(new URL("../scripts/start-host.mjs", import.meta.url), "utf8"),
    readFile(new URL("../scripts/start-flash.mjs", import.meta.url), "utf8"),
    readFile(new URL("../scripts/start-everything.mjs", import.meta.url), "utf8"),
    readFile(new URL("../scripts/cleanup-watchdog.mjs", import.meta.url), "utf8"),
    readFile(new URL("../.env.example", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../start-host.cmd", import.meta.url), "utf8"),
    readFile(new URL("../local-test.cmd", import.meta.url), "utf8"),
    readFile(new URL("../start-flash-player.cmd", import.meta.url), "utf8"),
  ]);
  assert.doesNotMatch(layout, /next\/font/);
  assert.doesNotMatch(home, /next\/link/);
  assert.doesNotMatch(page, /next\/link/);
  assert.match(home, /href="\/free"/);
  assert.doesNotMatch(home, /href="\/turns"|红蓝|红方|蓝方|回合对战/);
  assert.match(freeRoute, /<RelayRoom \/>/);
  assert.match(page, /NEXT_PUBLIC_SIGNAL_URL/);
  assert.match(page, /getDisplayMedia/);
  assert.match(page, /replaceTrack/);
  assert.match(page, /更换共享窗口/);
  assert.match(signal, /reset-control-for-share/);
  assert.match(page, /contentHint\s*=\s*["']motion["']/);
  assert.match(page, /degradationPreference\s*=\s*["']maintain-framerate["']/);
  assert.match(page, /maxFramerate\s*=\s*profile\.frameRate/);
  assert.match(page, /approve-peer/);
  assert.match(page, /getStats/);
  assert.match(page, /createDataChannel\("controls", \{ ordered: true \}\)/);
  assert.match(page, /createDataChannel\("pointer", \{ ordered: false, maxRetransmits: 0 \}\)/);
  assert.match(page, /pointerChannelsRef/);
  assert.match(signal, /new WebSocketServer/);
  assert.match(signal, /roomCode/);
  assert.match(signal, /generate-ice-servers/);
  assert.match(signal, /get-ice-servers/);
  assert.match(signal, /reclaim-control/);
  assert.match(signal, /controlLeaseMs/);
  assert.doesNotMatch(signal, /pass-control|turnDurationMs|turnDeadline|turnNumber/);
  assert.match(signal, /socket\.ping/);
  assert.match(companion, /127\.0\.0\.1/);
  assert.match(companion, /--arm/);
  assert.match(companion, /Page\.getLayoutMetrics/);
  assert.match(companion, /Input\.dispatchMouseEvent/);
  assert.match(companion, /Input\.dispatchKeyEvent/);
  assert.match(companion, /Input\.insertText/);
  assert.match(proxy, /PUBLIC_HTTP_PORT/);
  assert.match(hostLauncher, /ensureBrowser/);
  assert.match(hostLauncher, /companion\/server\.mjs/);
  assert.match(hostLauncher, /scripts\/dev\.mjs/);
  assert.doesNotMatch(hostLauncher, /playerUrl|8790|Flash/);
  assert.match(flashLauncher, /scripts\/mutiny-local\.mjs/);
  assert.match(lazyLauncher, /cleanup-watchdog\.mjs/);
  assert.match(lazyLauncher, /Browser\.close/);
  assert.match(lazyLauncher, /findOrInstallBrowser/);
  assert.doesNotMatch(lazyLauncher, /mutiny-local\.mjs|mutiny\.swf|playerUrl/);
  assert.match(watchdog, /terminateTree/);
  assert.match(watchdog, /Browser\.close/);
  assert.match(page, /window\.location\.port === "3000"/);
  assert.match(page, /ws:\/\/127\.0\.0\.1:8787/);
  assert.match(page, /选择控制目标/);
  assert.match(page, /Windows 应用窗口/);
  assert.match(page, /mobileControlOverlay/);
  assert.match(page, /mobileDefaultActions/);
  assert.match(page, /自定义悬浮按键/);
  assert.match(page, /customVirtualKeysStorageKey/);
  assert.match(page, /document\.fullscreenElement/);
  assert.match(page, /onPointerCancel/);
  assert.ok(page.indexOf('className="videoViewport"') < page.indexOf("mobileControlOverlay"));
  assert.ok(page.indexOf("mobileControlOverlay") < page.indexOf('className="commandLog"'));
  assert.match(styles, /\.videoViewport:fullscreen/);
  assert.match(styles, /\.mobileControlOverlay/);
  assert.match(page, /jitterBufferTarget\s*=\s*20/);
  assert.match(page, /requestVideoFrameCallback/);
  assert.match(page, /captureTime/);
  assert.match(page, /画面延迟/);
  assert.match(page, /onContextMenu/);
  assert.match(page, /共享系统音频/);
  assert.match(page, /audio:\s*includeAudio/);
  assert.match(page, /近 2 秒丢包/);
  assert.match(page, /视频传输档位/);
  assert.match(page, /maxBitrate/);
  assert.match(page, /3_500_000/);
  assert.match(page, /preferH264Video/);
  assert.match(page, /setCodecPreferences/);
  assert.match(page, /freezeCount/);
  assert.match(page, /nackCount/);
  assert.match(page, /jitterBufferMinimumDelay/);
  assert.match(page, /jitterBufferTargetDelay/);
  assert.match(page, /totalDecodeTime/);
  assert.match(styles, /-webkit-touch-callout:none/);
  assert.match(page, /react-simple-keyboard/);
  assert.match(page, /onKeyReleased/);
  assert.match(page, /lostpointercapture/);
  assert.match(page, /visibilitychange/);
  assert.match(page, /pressedPhysicalKeysRef/);
  assert.match(companion, /pendingPointerMove/);
  assert.match(companion, /schedulePointerMove/);
  assert.match(page, /TURN 已就绪/);
  assert.doesNotMatch(page, /红蓝|红方|蓝方|回合对战|turnSecondsLeft/);
  assert.match(page, /校准由房主控制/);
  assert.match(page, /开始校准/);
  assert.match(page, /重新开始校准/);
  assert.match(page, /取消校准/);
  assert.match(page, /重新连接/);
  assert.match(signal, /reset-control-session/);
  assert.match(signal, /reload-session-ready/);
  assert.match(page, /媒体与控制连接已停止/);
  assert.match(companion, /setLocalInputLocked/);
  assert.match(companion, /Page\.bringToFront/);
  assert.match(companion, /if \(!\(target instanceof CdpTarget\)\) return/);
  assert.match(nativeHost, /IsCenterVisible/);
  assert.match(nativeHost, /AttachThreadInput/);
  assert.match(nativeHost, /BringWindowToTop/);
  assert.match(nativeHost, /SetProcessDpiAwarenessContext/);
  assert.match(nativeHost, /MonitorFromWindow/);
  assert.match(nativeHost, /SendInput/);
  assert.match(nativeHost, /MapVirtualKey/);
  assert.match(nativeHost, /if \(down && GetAncestor\(GetForegroundWindow\(\), 2\)/);
  assert.match(companion, /set-capture-info/);
  assert.match(nativeHost, /0x0004u/);
  assert.match(nativeHost, /SendMouseButton/);
  assert.match(page, /displaySurface/);
  assert.match(nativeHost, /"activate"/);
  assert.match(signal, /只有房主可以发起校准/);
  assert.match(envExample, /NEXT_PUBLIC_TURN_URLS/);
  assert.match(packageJson, /server\/signaling\.mjs/);
  assert.match(packageJson, /"companion:arm": "node companion\/server\.mjs --arm"/);
  assert.match(packageJson, /"host:start"/);
  assert.match(packageJson, /"flash:start"/);
  assert.match(packageJson, /"lazy:start"/);
  assert.match(packageJson, /"control:start"/);
  for (const command of [hostCommand, localTestCommand, flashCommand]) assert.equal(Buffer.from(command, "ascii").toString("ascii"), command);
  assert.match(hostCommand, /npm run control:start/);
  assert.match(localTestCommand, /npm run dev/);
  assert.match(localTestCommand, /npm run companion:arm/);
  assert.match(flashCommand, /npm run flash:start/);
  await assert.rejects(access(new URL("../deploy%20%26%20clean.cmd", import.meta.url)));
  await assert.rejects(access(new URL("../启动Flash播放器.cmd", import.meta.url)));
  await assert.rejects(access(new URL("../启动房主环境.cmd", import.meta.url)));
  await assert.rejects(access(new URL("../一键部署远程操控并清理.cmd", import.meta.url)));
  await access(new URL("../companion/windows-native.mjs", import.meta.url));
  await access(new URL("../companion/windows-native-host.ps1", import.meta.url));
  await assert.rejects(access(new URL("../app/turns/page.tsx", import.meta.url)));
  await assert.rejects(access(new URL("../companion/windows-input.ps1", import.meta.url)));
  await assert.rejects(access(new URL("app/_sites-preview/SkeletonPreview.tsx", root)));
});
