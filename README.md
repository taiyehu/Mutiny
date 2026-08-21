# Mutiny Relay

一个可复用于网页游戏和远程协作的同屏联机原型。房主在浏览器中分享目标窗口，访客通过 WebRTC 直接观看画面，并把鼠标、点击和键盘事件发送到房主选定的 Chromium 标签页。

## 当前能力

- 分享浏览器标签页、窗口或整个屏幕；
- 通过 WebRTC 进行端到端加密的点对点音视频传输；
- 不需要注册账号或业务数据库；
- 通过本地 WebSocket 信令服务生成 6 位房间码；
- 首页可选择“通用远程协作”或“红蓝回合对战”；
- 房主逐个批准访客，并可将其设为远端操作者或只读观众；
- 两种模式都使用独立的两点校准阶段，校准由远端窗口在房主页面助手就绪后发起；
- 校准点击距离过近时会回到第一个定位点，远端可继续点击、重新开始或取消；取消、断线和房主收回都会显式移除定位点并解除页面输入锁；
- 助手重新连接或房主切换访客身份时，会清除上一轮控制状态并自动重建该访客的 WebRTC 媒体与控制通道，无需手动刷新或重新输入房间码；
- 校准完成后以及正在控制期间，远端仍可点击“重新校准坐标”；重新校准会暂停当前控制，完成后由房主再次启用页面控制；
- 通用模式不带阵营轮换和倒计时，获准的远端操作者可持续控制；
- 回合模式由蓝方房主固定先手，蓝红双方点击“结束回合”交接，每回合默认 60 秒，归零后由服务端自动交棒；
- 房主可随时强制收回控制权或关闭房间；红方断线、降级或控制租约超时也会自动归还蓝方，避免死锁；
- 信令服务器定期发送 WebSocket Ping，防止公网隧道把仍在游玩的空闲信令连接提前关闭；
- 访客可发送鼠标位置、点击和键盘按键；
- 房主端会显示访客的远程指针和最近一次操作；
- 远程坐标以实际视频内容区域为基准，并自动跟随共享画面的宽高比；
- Chromium 页面控制助手连接后默认处于安全预览模式，房主必须选择标签页并再次确认才会发送输入；
- 访客画面支持 100%–250% 缩放、滚动查看和全屏显示；
- 实时显示延迟、视频码率、帧率和丢包统计；
- 支持最多 8 位本地测试成员，房主为每位访客建立独立 WebRTC 连接；
- 提供仅监听本机地址、带一次性授权码的 Chromium 页面控制助手；
- 可以通过环境变量配置自建 STUN/TURN；
- 支持桌面与移动端的响应式界面。

## 重要限制

浏览器网页本身不能向另一个标签页注入可信输入。本项目提供一个可选的 Chromium 页面控制助手：它通过 Chrome DevTools Protocol（CDP）连接本机以远程调试模式启动的 Chrome、Edge 或 Chromium，并使用 `Input.dispatchMouseEvent` 与 `Input.dispatchKeyEvent` 只向房主选定的标签页发送事件。它不会移动操作系统鼠标，也不会控制其他桌面程序。

访客坐标先根据视频中真正显示的内容区域换算为比例，自动排除 `object-fit: contain` 产生的黑边；助手再读取目标标签页实时的 `window.innerWidth` 和 `window.innerHeight`，换算为该页面 viewport 中的 CSS 像素。鼠标按下和抬起、键盘按下和抬起都会分别传输，因此拖动、长按方向键以及依赖 `mousedown`/`mouseup` 的游戏可以正常接收。校准阶段和红方回合期间，助手通过 CDP `Input.setIgnoreInputEvents` 在浏览器输入层屏蔽房主对目标游戏页的本地鼠标和键盘；每个经过授权的远端事件注入前会短暂放行，注入后立即重新锁定。房主仍可在独立的联机管理页强制收回或关闭房间。测试时应分享被选中的浏览器标签页，而不是整个屏幕或带浏览器边框的窗口。目标标签页关闭后控制会自动停用。CDP 本身权限很高，只应绑定 `127.0.0.1`、使用独立的临时浏览器配置目录，并只向可信访客授予操作权限。

此外，目前只配置了公共 STUN 服务。部分公司网络、校园网、运营商 NAT 或严格防火墙环境无法建立直接连接；正式使用时应部署 TURN 服务作为中继。

## 工作原理

项目把两条 WebRTC 通道与服务端控制状态结合起来：

1. **MediaStream**：房主调用 `getDisplayMedia()` 获取用户选择的画面和音频，然后将媒体轨道加入 `RTCPeerConnection`。
2. **RTCDataChannel**：远端把归一化后的鼠标坐标、点击和按键事件发送给房主。通用模式接受所有获准操作者的输入；回合模式会在发送端和房主端分别校验控制令牌。
3. **校准与控制状态机**：房主选定 Chromium 页面后，信令服务通知远端显示“开始两点校准”。校准完成后由房主启用页面控制。通用模式进入持续控制；回合模式进入蓝方第 1 回合，每回合默认 60 秒，归零自动轮换。房主关闭房间、成员断线、权限降级以及失去心跳都会安全停止或收回控制。

短房间码和授权流程如下：

```text
房主浏览器                         访客浏览器
    │                                  │
    ├─ 选择共享窗口                    │
    ├─ 向本地信令服务创建 6 位房间码    │
    │<────────────── 输入房间码并申请权限┤
    ├─ 批准操作或只读观战               │
    ├─ 通过信令服务交换 SDP 与 ICE ─────┤
    │                                  │
    ├════ 加密视频/音频（WebRTC）══════>│
    │<══ 鼠标、点击、按键（DataChannel）┤
```

本地信令服务只在内存中保存房间成员，并转发 SDP 和 ICE 协商消息，不接收或保存游戏画面。房主退出或服务重启后，房间会立即失效。

## 项目组成

```text
app/
├─ page.tsx          模式选择页
├─ relay-room.tsx    两种模式共用的 WebRTC、屏幕捕获和控制界面
├─ free/page.tsx     无倒计时的通用远程协作入口
├─ turns/page.tsx    红蓝双方 60 秒轮换入口
├─ globals.css       页面样式与响应式布局
├─ layout.tsx        页面元数据及社交分享配置
└─ chatgpt-auth.ts   Sites 模板提供的可选登录辅助，目前未使用

public/
├─ og.png            社交分享预览图
└─ favicon.svg       站点图标

server/signaling.mjs 本地 WebSocket 信令、房间码和权限管理
scripts/dev.mjs      同时启动网页与信令服务
companion/
└─ server.mjs        带一次性授权的 WebSocket/CDP 页面输入桥接

worker/index.ts      Cloudflare Worker 入口
vite.config.ts       vinext、Vite、Cloudflare 与 Sites 插件配置
.openai/hosting.json OpenAI Sites 部署配置
db/、drizzle/        模板预留的数据层，目前原型不使用数据库
```

房间只保存在本地信令进程的内存中；项目没有用户系统、房间数据库或游戏逻辑服务端。

## 本地部署攻略

本节从一个已经下载到本机的项目目录开始，分别介绍纯本地游戏、单机联机测试、页面输入注入和局域网双机测试。所有命令都应在项目根目录执行。

### 通用远程操控与 Mutiny 播放器

这两部分现在完全独立，可以分别启动和关闭：

- **通用远程操控**：双击 `一键部署远程操控并清理.cmd`；
- **Mutiny / Flash 播放器**：双击 `启动Flash播放器.cmd`。

通用远程操控脚本会依次：

1. 检查 Node.js；缺失时通过 Windows `winget` 安装 Node.js LTS；
2. 检查 npm 项目依赖；缺失时自动执行 `npm ci`；
3. 检查 Chrome、Edge 或 Chromium；全部缺失时通过 `winget` 安装 Microsoft Edge；
4. 启动专用 Chromium、房主页面和 companion；房主页面为本地地址时还会启动网页与信令服务；
5. 在按 `Ctrl+C`、关闭启动窗口或启动中途出错后，自动结束本次脚本创建的进程并删除临时浏览器配置。

脚本只回收自己创建的进程。若 `9222`、`8765` 等所需端口已被其他程序占用，它会停止启动并提示先关闭占用者，不会冒险结束未知进程。通用操控脚本不检查、不启动也不关闭 Ruffle 或任何 Flash 游戏。

也可以在已安装 Node.js 22.13 或更高版本的终端运行：

```bash
npm run control:start
```

原来的 `npm run lazy:start` 作为兼容别名保留，其行为与 `npm run control:start` 相同。单独启动 Mutiny 播放器可运行：

```bash
npm run flash:start
```

`mutiny.swf` 属于游戏文件，必须由你在获得许可后自行放入项目根目录，播放器脚本不会从网络下载它。

另外还保留了较轻量的房主启动器：

- `启动房主环境.cmd`：首次运行时从 `.env.example` 创建 `.env.local`，启动本地网页与信令服务、打开同一个 Chromium 实例，并在终端启动 companion、显示 6 位授权码。

也可以在 Windows、Linux 或 macOS 的终端执行等价命令：

```bash
npm run host:start
```

独立 Flash 启动器和轻量房主启动器可以任意顺序运行，后启动者会复用已有的 Chromium，但房主启动器不会主动探测或打开 Flash 页面。完整的通用远程操控脚本使用自己的临时 Chromium 配置，为保证退出时能准确清理，应先启动它，再启动 Flash 播放器。需要控制 Mutiny 时，从 companion 的目标列表中明确选择 Flash 页面。按 `Ctrl+C` 停止对应脚本创建的服务。

只检查环境、不启动任何服务：

```bash
npm run flash:check
npm run host:check
```

房主启动器默认使用本地页面。如果要使用已经部署的公网服务器，编辑 `.env.local`：

```dotenv
HOST_RELAY_URL=https://你的公网域名和端口/
HOST_START_DEV=false
```

其他可选配置：

```dotenv
HOST_PLAYER_URL=http://127.0.0.1:8790/
HOST_CDP_PORT=9222
HOST_COMPANION_PORT=8765
HOST_BROWSER_PATH=C:\Program Files\Google\Chrome\Application\chrome.exe
```

`HOST_BROWSER_PATH` 留空时会依次查找 Chrome、Edge 和 Chromium。浏览器使用独立的临时配置目录，CDP 与 companion 始终只监听 `127.0.0.1`。启动器只会在 `.env.local` 不存在时创建它，不会覆盖已有 TURN 密钥或其他配置。

### 1. 选择运行方式

| 目标 | 需要启动的服务 | 默认地址 |
| --- | --- | --- |
| 只运行 Mutiny | Ruffle 本地播放器 | `http://127.0.0.1:8790/` |
| 一台电脑测试创建/加入房间 | 网页 + 信令 | `http://localhost:3000/`、`ws://127.0.0.1:8787` |
| 让访客实际操作游戏页面 | 上述服务 + Chromium + 页面控制助手 | CDP `9222`、助手 `8765` |
| 同一局域网两台电脑测试 | 对局主机开放网页和信令端口 | `http://主机局域网IP:3000/` |

### 2. 准备环境和安装依赖

需要 Node.js `22.13.0` 或更高版本。先检查版本：

```bash
node --version
npm --version
```

安装锁定版本的依赖：

```bash
npm ci
```

如果正在修改依赖而不是部署已有版本，可以改用 `npm install`。复制本地环境变量模板：

Windows PowerShell：

```powershell
Copy-Item .env.example .env.local
```

Linux 或 macOS：

```bash
cp .env.example .env.local
```

单机运行不需要修改默认值。默认信令服务只监听 `127.0.0.1:8787`，不会暴露到局域网。

### 3. 提取并运行本地游戏

把已获合法使用许可的外层文件放到项目根目录，并命名为：

```text
mutiny.swf
```

依次执行：

```bash
npm run mutiny:extract
npm run mutiny:patch
npm run mutiny:local
```

三个命令分别执行以下操作：

1. 从外层 SWF 的 `DefineBinaryData` 标签提取内层游戏；
2. 在验证 AS2 字节码结构后生成经许可的本地补丁版，原版不会被覆盖；
3. 在 `127.0.0.1:8790` 启动 Ruffle 和 SWF 静态服务。

看到下面的信息即表示启动成功：

```text
Mutiny 纯本地播放器：http://127.0.0.1:8790/
版本：本地许可补丁版
```

保持该终端运行，然后打开 `http://127.0.0.1:8790/`。按 `Ctrl+C` 停止服务。替换了根目录的 `mutiny.swf` 后，应重新执行提取和补丁命令，并重启播放器。

如果 `8790` 已被占用，可以直接打开该地址检查播放器是否已经运行，或者临时换一个端口。

Windows PowerShell：

```powershell
$env:LOCAL_PLAYER_PORT=8791
npm run mutiny:local
```

Linux 或 macOS：

```bash
LOCAL_PLAYER_PORT=8791 npm run mutiny:local
```

### 4. 在一台电脑上测试联机

保留 Ruffle 播放器终端，再打开第二个终端：

```bash
npm run dev
```

该命令同时启动：

- 联机网页：`http://localhost:3000/`
- WebSocket 信令：`ws://127.0.0.1:8787`

测试步骤：

1. 在两个浏览器窗口中分别打开 `http://localhost:3000/`，并在两边选择相同的模式；通用模式入口是 `/free`，回合模式入口是 `/turns`；
2. 第一个窗口选择“创建房间”，并在浏览器的共享选择器中选择 `Mutiny · 本地 Ruffle 播放器` 标签页；
3. 第二个窗口选择“加入房间”，输入房间码并申请“允许操作”或“只读观战”；
4. 房主批准访客；
5. 检查访客是否收到画面，房主是否看到远程指针和操作提示。

此时访客的操作默认只是传回房主页面并显示远程指针。要让点击和按键真正进入游戏，继续配置下一节的页面控制助手。

### 5. 启用 Chromium 页面输入

页面控制助手只向房主明确选择的 Chromium 标签页注入事件，不控制系统鼠标。游戏标签页必须在这个以远程调试模式启动的独立浏览器实例中打开。

先完全关闭准备作为测试目标的独立 Chromium，再启动它。

Chrome（Windows PowerShell）：

```powershell
& "$env:ProgramFiles\Google\Chrome\Application\chrome.exe" `
  --remote-debugging-port=9222 `
  --remote-debugging-address=127.0.0.1 `
  --user-data-dir="$env:TEMP\mutiny-cdp-profile"
```

Edge（Windows PowerShell）：

```powershell
& "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe" `
  --remote-debugging-port=9222 `
  --remote-debugging-address=127.0.0.1 `
  --user-data-dir="$env:TEMP\mutiny-cdp-profile"
```

Chrome（Linux）：

```bash
google-chrome \
  --remote-debugging-port=9222 \
  --remote-debugging-address=127.0.0.1 \
  --user-data-dir=/tmp/mutiny-cdp-profile
```

在这个独立 Chromium 中打开 `http://127.0.0.1:8790/`，并建议把房主的 `http://localhost:3000/` 联机页面也放在同一 Chromium 实例中，这样共享选择器可以直接选择 Ruffle 标签页。然后在第三个终端启动助手：

```bash
npm run companion:arm
```

终端会显示一次性 6 位授权码。回到房主联机页面：

1. 输入授权码并连接；
2. 从标签页列表选择 Mutiny Ruffle 页面；
3. 等房主页面显示目标已锁定后，在访客窗口点击“开始两点校准”，并依次点击共享画面中的两个定位点；
4. 校准完成后由房主点击“启用页面控制”；回合模式从蓝方 60 秒回合开始，通用模式则允许获准操作者持续控制；
5. 让访客测试鼠标移动、单击、拖动和键盘操作。

助手、目标 Chromium 或目标标签页任意一个关闭后，页面输入都会停止。修改助手代码后必须停止并重新启动助手进程。

### 6. 在局域网两台电脑之间测试

以下方式适合可信局域网中的开发测试。假设运行项目的电脑局域网地址为 `192.168.2.10`，请替换为实际地址。

编辑 `.env.local`，为网页前端设置访客可访问的信令地址：

```dotenv
NEXT_PUBLIC_SIGNAL_URL=ws://192.168.2.10:8787
```

然后在 `.env.local` 中继续加入信令监听设置：

```dotenv
SIGNAL_HOST=0.0.0.0
SIGNAL_PORT=8787
```

项目的 npm 启动命令会自动读取 `.env.local`。分别启动信令和网页，使它们监听局域网网卡。

终端一：

```bash
npm run dev:signal
```

终端二：

```bash
npm run dev:web -- --host 0.0.0.0
```

访问方式：

- 房主电脑打开 `http://localhost:3000/`，这样屏幕分享仍处于浏览器认可的安全上下文；
- 访客电脑打开 `http://192.168.2.10:3000/`；
- 两台电脑都连接 `ws://192.168.2.10:8787` 信令服务。

如果访客打不开页面，需要在主机防火墙中仅对“专用/家庭网络”放行 TCP `3000` 和 `8787`。这套 HTTP/WS 配置只适合可信局域网，不应直接暴露到公网。需要局域网 HTTPS 或公网访问时，请使用后文的 `npm run start:lan`、反向代理或隧道方案。

CDP 页面助手始终运行在房主电脑上，并继续只监听 `127.0.0.1`；不要向局域网或公网开放 `8765` 和 `9222`。

### 7. 停止、重启和检查

每个服务都可以在其终端按 `Ctrl+C` 停止。代码或环境变量发生变化后，应停止旧进程再重新运行，避免浏览器仍连接旧版本。

Windows 查看常用端口：

```powershell
netstat -ano | findstr ":3000 :8787 :8790 :8765 :9222"
```

Linux 查看常用端口：

```bash
ss -ltnp | grep -E ':(3000|8787|8790|8765|9222)\b'
```

部署完成后可以执行基础检查：

```bash
npm run lint
npm test
```

### 8. 常见问题

| 现象 | 处理方式 |
| --- | --- |
| `EADDRINUSE` | 对应端口已有进程；先打开地址确认服务是否已经运行，或停止旧终端、改用其他端口。 |
| 显示 `URL-Locked` | 确认已在获得许可后执行 `npm run mutiny:patch`，并重启 `mutiny:local`。 |
| 页面显示“未修改原版” | 补丁文件不存在或比新提取的 SWF 更旧；重新运行 `npm run mutiny:patch`。 |
| 房间不存在 | 两个窗口没有连接同一个信令地址，或房主/信令服务已经重启。 |
| 无法分享屏幕 | 房主应使用 `localhost` 或有效 HTTPS 地址，并在浏览器提示中手动选择共享目标。 |
| 访客只有画面、不能点击 | 这是默认安全行为；启动页面控制助手、输入一次性授权码、选择目标并启用控制。 |
| 助手提示旧版本或 `8765` 被占用 | 在旧助手终端按 `Ctrl+C`，确认进程退出后重新运行 `npm run companion:arm`。 |
| 鼠标有明显偏移 | 分享游戏标签页而不是整个桌面，确认选择了正确 CDP 目标，然后执行两点坐标校准。 |
| 外网或严格 NAT 下无法连接 | 配置自己的 TURN 服务；仅使用公共 STUN 不能覆盖所有网络。 |

## 运行环境

### 纯本地运行原版 SWF

将合法取得的原始文件命名为项目根目录下的 `mutiny.swf`，然后运行：

```bash
npm run mutiny:extract
npm run mutiny:patch
npm run mutiny:local
```

打开 `http://127.0.0.1:8790/`。提取脚本会从外层加载器的 `DefineBinaryData` 标签中找到并校验唯一的内层 SWF，输出到 `local-player/mutiny-game.swf`；本地服务器使用项目安装的 Ruffle 自托管文件播放它，只监听 `127.0.0.1`。

内层游戏带有 Nitrome 的 `URL-Locked` 站点检查。取得修改许可后，`npm run mutiny:patch` 会验证 `NitromeGame.getNitrome()` 的 AS2 字节码结构，并只把该函数的默认许可值从 `false` 改为 `true`。原文件保持不变，补丁版输出为 `local-player/mutiny-game-local.swf`，本地服务器会优先选用时间较新的补丁版。

`mutiny.swf`、提取后的 `mutiny-game.swf` 和补丁版都已被 Git 忽略，也不在 Linux/SakuraFrp 部署包中。除非另有分发授权，不要把它们复制到 `public/` 或上传到公网服务器。

### 开发环境

- Node.js `>= 22.13.0`
- npm
- Windows、macOS 或 Linux
- 新版 Chrome、Edge 或 Firefox
- 可访问 STUN 服务的网络

安装并启动：

```bash
npm install
npm run dev
```

然后打开：

```text
http://localhost:3000
```

这条命令会同时启动：

- 网页：`http://localhost:3000`
- 信令 WebSocket：`ws://127.0.0.1:8787`

`localhost` 被浏览器视为安全上下文，因此本地开发时可以调用屏幕分享接口。若需要分别调试，可以使用 `npm run dev:web` 和 `npm run dev:signal`。

### 启用 Chromium 页面输入

先完全关闭准备作为测试目标的独立浏览器实例，再用单独的配置目录启动它。Windows PowerShell 中可运行 Chrome：

```powershell
& "$env:ProgramFiles\Google\Chrome\Application\chrome.exe" `
  --remote-debugging-port=9222 `
  --remote-debugging-address=127.0.0.1 `
  --user-data-dir="$env:TEMP\mutiny-cdp-profile"
```

若使用 Edge：

```powershell
& "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe" `
  --remote-debugging-port=9222 `
  --remote-debugging-address=127.0.0.1 `
  --user-data-dir="$env:TEMP\mutiny-cdp-profile"
```

然后在项目的另一个终端中启动助手：

在另一个终端中明确启动辅助程序：

```bash
npm run companion:arm
```

终端会显示一次性 6 位授权码。在房主页面的“Chromium 页面控制助手”区域输入授权码，选择目标标签页，再点击“启用页面控制”。普通的 `npm run companion` 不会启用输入；按 `Ctrl+C` 会立即停止。若使用其他本机 CDP 端口，可运行 `npm run companion:arm -- --cdp=http://127.0.0.1:端口`。

修改助手代码后必须先在旧终端按 `Ctrl+C`，再重新执行 `npm run companion:arm`；浏览器页面会拒绝连接仍驻留在 8765 端口的旧协议助手。选择目标后，界面会显示助手实际读取到的 viewport 尺寸，可用于核对坐标映射。

如果鼠标仍有明显偏移，先保持“页面控制”关闭。房主选定目标标签页后，由访客窗口点击“开始两点校准”，再在共享画面中依次准确点击 `1 / 2` 和 `2 / 2` 两个圆形定位点。助手会根据样本计算横纵方向各自的缩放和偏移；显示“校准完成”后，再由房主点击“启用页面控制”。如果两次点击距离过近，助手会重新显示第一个定位点，访客可以直接继续，也可以点击“重新开始校准”或“取消校准”。切换目标标签页后需要重新校准。

建议在目标 Chromium 中只打开用于测试的游戏页面，不要登录邮箱、支付或管理后台。助手拒绝连接非本机 CDP 地址，但同一调试实例内所有页面仍具有较高权限。

### 配置 TURN

公网连接推荐使用服务端签发的短期 TURN 凭据。以 Cloudflare Realtime TURN 为例：

1. 在 Cloudflare Dashboard 的 Realtime / TURN 中创建 TURN Key；
2. 取得 TURN Key ID 和对应 API Token；
3. 本地开发时把它们写入 `.env.local`，不要使用 `NEXT_PUBLIC_` 前缀：

```dotenv
CLOUDFLARE_TURN_KEY_ID=你的KeyID
CLOUDFLARE_TURN_API_TOKEN=你的APIToken
TURN_TTL_SECONDS=3600
CONTROL_LEASE_SECONDS=90
TURN_DURATION_SECONDS=60
```

`npm run dev` 会自动加载该文件。浏览器连接信令后，服务端会向 Cloudflare 换取短期凭据、过滤浏览器容易超时的 53 端口，并通过现有信令连接返回 ICE 配置。长期 API Token 不会发送给浏览器。

Linux 部署时复制密钥模板：

```bash
cp deploy/turn.env.example deploy/turn.env
chmod 600 deploy/turn.env
```

填写 `deploy/turn.env` 后重启用户服务：

```bash
systemctl --user daemon-reload
systemctl --user restart mutiny-relay.service
journalctl --user -u mutiny-relay.service -n 50 --no-pager
```

日志应显示 `TURN：Cloudflare 短期凭据`。创建或加入房间后，网页连接栏应先显示 `TURN 已就绪`；当直连失败而中继成功时，会显示 `TURN 中继`。

如果使用其他供应商，也可以在服务端设置静态凭据：

```dotenv
STUN_URLS=stun:turn.example.com:3478
TURN_URLS=turn:turn.example.com:3478?transport=udp,turn:turn.example.com:3478?transport=tcp,turns:turn.example.com:5349?transport=tcp
TURN_USERNAME=用户名
TURN_CREDENTIAL=凭据
```

原有的 `NEXT_PUBLIC_TURN_*` 前端变量仍可用于临时兼容测试，但会把固定凭据打包到浏览器代码中，不建议用于公网部署。

生产构建：

```bash
npm run build
npm run start
```

代码检查：

```bash
npm run lint
```

## 可以部署在自己的服务器上吗？

可以。需要特别注意以下三点：

1. **必须使用 HTTPS**：除 `localhost` 外，浏览器只允许安全来源调用屏幕捕获相关接口。
2. **服务器只负责提供网页**：建立连接后，音视频默认在两位玩家之间直接传输，不会经过网页服务器。
3. **正式环境建议配置 TURN**：仅使用 STUN 无法覆盖所有 NAT 和防火墙环境。

### 方案一：Linux VPS + 反向代理

在服务器上安装 Node.js 22，拉取项目后执行：

```bash
npm ci
npm run build
npm run start
```

应用默认监听本机的 3000 端口。再使用 Caddy 或 Nginx 把域名的 HTTPS 请求反向代理到 `127.0.0.1:3000`。推荐用 systemd、Docker Compose 或其他进程管理工具保证服务自动重启。

Caddy 配置示例：

```caddyfile
relay.example.com {
    reverse_proxy 127.0.0.1:3000
}
```

Caddy 会在域名 DNS 已正确解析、80/443 端口开放的情况下自动申请 HTTPS 证书。

### 当前局域网 Linux 部署

仓库包含一个不依赖 Caddy/Nginx 的局域网 HTTPS 入口：

- `scripts/start-lan.mjs` 同时启动网页、信令和 TLS 代理；
- `server/lan-proxy.mjs` 把 HTTPS 请求转发到网页服务，并把 `/signal` 的 WSS 连接转发到信令服务；
- `deploy/mutiny-relay.service` 是用户级 systemd 服务示例。

当前测试部署地址为：

```text
https://192.168.2.20:3443/
```

服务还可以通过 `PUBLIC_HTTP_HOST=127.0.0.1`、`PUBLIC_HTTP_PORT=3080` 开启一个只供本机隧道客户端使用的明文统一入口。它同时代理网页请求和 `/signal` WebSocket，不应直接监听公网网卡。

### SakuraFrp 公网隧道

推荐在 SakuraFrp 面板创建一条 **TCP 隧道**：

- 节点：选择允许建站的非内地节点；
- 本地 IP：`127.0.0.1`；
- 本地端口：`3080`；
- 自动 HTTPS：`自动`；
- 子域绑定：绑定一个免费的 `nyat.app` 子域名；
- 开机启动：在 Linux 启动器远程管理中启用该隧道，或加入自动启动列表。

子域证书签发并加载完成后，使用面板给出的 `https://子域:远程端口` 访问。网页和 WSS 信令共用这一条隧道；客户端代码会根据当前 HTTPS 地址自动连接同域 `/signal`。不要把局域网的 `3443` 自签名 HTTPS 再套一层自动 HTTPS。

局域网证书由私有 CA 签发。每台需要访问的客户端都必须信任该 CA，否则浏览器不会把页面视为可调用屏幕分享接口的安全来源。不要把 CA 私钥复制到客户端；客户端只需要 `.crt` 公共证书。

Linux 主机上的常用维护命令：

```bash
systemctl --user status mutiny-relay.service
systemctl --user restart mutiny-relay.service
journalctl --user -u mutiny-relay.service -f
```

用户级服务默认在该 Linux 用户登录后启动。若需要在系统启动、用户尚未登录时也运行，需要管理员执行：

```bash
sudo loginctl enable-linger eighteen-wang
```

### 方案二：Cloudflare Workers / OpenAI Sites

本项目的 vinext 构建目标原生兼容 Cloudflare Worker，目前也已包含 OpenAI Sites 配置。这条路线无需维护 VPS，但使用其他账号或项目部署时，应修改或重新生成 `.openai/hosting.json` 中的站点项目配置，不要复用现有 `project_id`。

### TURN 服务

公网使用推荐前文的 Cloudflare 短期凭据方案。Cloudflare 官方当前提供每月前 1,000 GB 免费额度，超出后按量计费；具体额度和价格应以其官网为准。也可以在具有公网 IP 的 VPS 上部署 coturn，但需要开放 TURN 监听端口及 UDP relay 端口范围，局域网主机加单端口 SakuraFrp 隧道不能直接替代它。

不要提交 `deploy/turn.env` 或把长期 TURN 密钥放进任何 `NEXT_PUBLIC_` 变量。TURN 中继音视频时会消耗供应商或 VPS 带宽。

## 隐私与安全

- 浏览器会在每次分享前要求房主明确选择窗口或屏幕；
- WebRTC 媒体和 DataChannel 使用 DTLS/SRTP 加密；
- 当前项目不会把 SDP、画面或操作记录写入数据库；
- 邀请文本包含临时网络信息，只应发送给准备加入本次连接的人；
- 停止浏览器的屏幕分享或退出房间即可关闭媒体轨道和连接。

## 开发进度

- [x] WebSocket 信令服务与 6 位房间码；
- [x] 房主确认、访客权限开关和只读观战；
- [x] 延迟、码率、帧率和丢包统计；
- [x] 可配置的 STUN/TURN 环境变量；
- [x] Chromium 页面控制助手、目标标签页选择及一次性授权；
- [x] 本地多人观战：房主与每位访客分别建立连接；
- [ ] 生产级 SFU：本地阶段没有引入 LiveKit、mediasoup 等独立媒体服务器。当前多人模式是 mesh，适合少量本地测试；人数增加后仍应切换 SFU，避免房主重复上传视频。

完整的 SFU 不是一个前端功能，需要运行独立媒体服务器、签发访问令牌并处理部署端口和 TURN。为了让当前仓库在不安装 Docker 或原生媒体依赖的电脑上仍能直接运行，本地版本保留了明确的 SFU 接入边界，没有伪装成已经实现的媒体转发。

## 技术栈

- React 19
- TypeScript 5
- vinext
- Vite 8
- WebRTC
- Cloudflare Workers / OpenAI Sites
