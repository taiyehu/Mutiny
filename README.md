# Mutiny Relay

Mutiny Relay 是一个面向网页游戏和远程协作的低延迟同屏控制工具：房主可以分享浏览器标签页、Windows 应用窗口或整个屏幕，访客通过 WebRTC 观看实时画面，并在房主授权后使用鼠标、触控和键盘远程操作。

## 普通用户：一键创建主机房间

环境要求：Windows 10/11、Node.js `22.13.0` 或更高版本，以及 Chrome、Edge 或 Chromium。

1. 下载项目后，双击根目录的 `start-host.cmd`。
2. 保持启动终端开启，把终端显示的 6 位“助手授权码”填入房主页面。
3. 在页面点击“分享屏幕并创建房间”，把页面显示的 6 位“房间码”发给访客。
4. 房主批准访客、选择控制目标、为访客校准，然后点击“启用远程控制”。
5. 结束时回到启动终端按 `Ctrl+C`，等待网页、信令、companion 和专用 Chromium 全部退出。

首次启动会自动安装项目依赖，并在缺少 `.env.local` 时从 `.env.example` 创建它。默认配置启动本地网页；如果使用已经部署的公网服务，请把 `.env.local` 改为：

```dotenv
HOST_RELAY_URL=https://your-relay.example.com/
HOST_START_DEV=false
```

不要同时运行 `start-host.cmd` 和 `npm run companion:arm`，否则两个助手会争用 `127.0.0.1:8765`。

## 开发者：本地一键联调

双击 `local-test.cmd`。它仅用于开发测试，会在两个终端中分别运行：

```text
npm run dev
npm run companion:arm
```

然后用普通浏览器打开 [http://localhost:3000/](http://localhost:3000/)。结束测试时，在两个新终端中分别按 `Ctrl+C`。

这个脚本不会启动带 CDP 调试端口的专用 Chromium。测试 Windows 应用控制不需要 CDP；测试 Chromium 标签页控制时，请改用 `start-host.cmd`，或手动启动带 `9222` 调试端口的 Chromium。

Flash 本地播放器使用独立入口 `start-flash-player.cmd`。

## 2026-08-25 更新摘要

本次迭代集中解决“画面已经足够低延迟，但手机操作仍不跟手”的问题：

- 音频轨与视频轨使用独立的单轨 `MediaStream`，避免音频接收缓冲通过同步组抬高视频播放延迟；
- 接收端把视频 `jitterBufferTarget` 设为 `0 ms`，音频保留约 `80 ms` 的缓冲目标，并继续把 `playoutDelayHint` 设为 `0`；
- 移动摇杆由固定圆盘改为 `nipplejs` 的 `dynamic + follow` 模式，左侧较大区域内任意落指都会在触点创建摇杆；
- 摇杆方向判定死区由 `0.22` 降为 `0.16`，库事件阈值由 `0.16` 降为 `0.08`；
- Esc、Space、Enter 与自定义按键改用原生 Pointer Event 监听，按下后直接发送，不等待 `click` 或 React 状态更新；
- 按键统一处理 `pointerup`、`pointercancel`、`lostpointercapture`、页面隐藏和窗口失焦，降低“松手后仍持续按下”的风险；
- 使用非被动 `touchstart`、`contextmenu` 拦截和 `user-select`/touch callout 样式，阻止移动浏览器长按复制、粘贴和文本选择菜单；
- 可靠有序的控制 DataChannel 保持不变：低延迟优化只发生在手机本地事件热路径，不用丢失 `key-up` 风险换取表面上的速度。

功能版本 `12ead74` 已通过 SSH release 流程部署到当前测试服务器，公网入口仍为 [https://www.u3690784.nyat.app:64515/free](https://www.u3690784.nyat.app:64515/free)。

## 最新远程实测结果

2026-08-22 的实际远程游戏窗口测试结果：

- 往返延迟约 `10 ms`；
- 动态游戏画面稳定在 `25–30 FPS`；
- 连续方向键输入正常；
- `Enter` 等按键可以稳定触发；
- 房主端可以正确看到远端按键状态；
- 鼠标、画面与键盘控制整体体验良好。

这是一次真实环境结果，不是所有网络的性能保证。VPN、运营商路由、TURN 中继距离、房主上行、捕获分辨率和目标应用刷新方式都会影响延迟和帧率。此前测试中 VPN 曾把延迟推高到约 1 秒，关闭 VPN 后恢复正常。

静止的 VS Code、记事本等文字窗口可能只编码发生变化的帧，因此统计帧率会低于游戏或持续滚动页面；判断性能时应在画面持续运动期间观察。

当前测试公网入口为 [https://www.u3690784.nyat.app:64515/](https://www.u3690784.nyat.app:64515/)。该地址由当前部署环境维护，不应被当作项目默认配置或永久服务承诺。

## 房主完整操作流程

1. 运行 `start-host.cmd`。
2. 打开准备分享的游戏、浏览器页面或普通 Windows 应用。
3. 在房主页面点击“分享屏幕并创建房间”。
4. 在系统共享选择器中选择目标窗口或屏幕。
5. 把房间码发送给访客。
6. 访客加入并申请“操作”权限。
7. 房主批准访客。
8. 房主输入启动终端显示的助手授权码并连接助手。
9. 在控制目标列表中选择与共享内容一致的窗口或 Chromium 标签页。
10. 房主在操作者旁点击“开始校准”。
11. Windows 应用窗口会自动置前并映射；Chromium 标签页需要远端依次点击两个定位点。
12. 房主确认目标正确后点击“启用远程控制”。

创建房间后，房主可以在共享画面标题栏点击“更换共享窗口”。系统会重新打开共享选择器，并把现有 WebRTC 连接的视频轨原位替换；房间码和成员保持不变，访客不需要重新加入。切换成功后远程控制会自动停止，房主需要重新选择助手目标、校准并启用控制。取消共享选择器时，原共享保持不变。

房间码与助手授权码是不同的 6 位码。房间码用于访客加入；助手授权码只允许房主页面连接本机 `8765` 服务，每次启动都会变化。

## Windows 应用窗口控制

Windows 原生输入宿主会枚举当前可见桌面会话中的顶层窗口：

- 鼠标依据共享窗口的 DWM 可见边界或目标显示器坐标映射；
- 使用每显示器 DPI 感知，减少缩放比例导致的偏移；
- 鼠标按钮和键盘统一通过 `SendInput` 注入；
- 普通文字通过 `KEYEVENTF_UNICODE` 批量注入；
- 方向键、导航键和右侧修饰键会带 Windows 扩展键标志；
- 停控、切换目标或断线时会主动释放尚未抬起的远端按键；
- 目标会在校准和启用控制时自动尝试置前；
- 点击前会检查目标位置是否被其他窗口覆盖；
- 原生窗口控制会移动房主的系统鼠标；
- 房主本地键鼠不会被驱动级锁定；
- 普通权限助手不能控制管理员权限应用；
- 反作弊、驱动级输入或明确拒绝 `SendInput` 的程序可能无法控制。

共享单个窗口时，浏览器共享选择器和助手目标列表必须选择同一个窗口。共享整个屏幕时，助手仍需选择实际受控窗口。目标被最小化、关闭、移动到其他显示器或改变共享对象后，应重新选择并校准。

companion 必须从房主自己的可见桌面终端启动。后台服务、CI 或非交互会话可能无法枚举和激活房主桌面上的窗口。

## Chromium 标签页控制

Chromium 标签页通过 Chrome DevTools Protocol 注入输入，不移动系统鼠标。`start-host.cmd` 会启动带独立临时配置目录的 Chromium，并把调试端口限制在 `127.0.0.1:9222`。

可打印字符使用 `keyDown`，方向键、Esc、Enter 等功能键使用 `rawKeyDown`；手机系统输入法提交的文字通过 `Input.insertText` 注入。事件包含 DOM `code`、Windows 虚拟键码、按键位置和修饰键状态。

房主选择标签页后为操作者发起两点校准。助手会自动把标签页置前，远端只负责依次点击定位点；开始、重试、取消和启用控制都由房主掌握。页面缩放、viewport 或捕获目标改变后，应重新校准。

Windows 应用控制不依赖 `9222`。CDP 不可用时，只要原生窗口列表正常，仍可以控制 Windows 应用。

## 手机和平板访客

手机和平板目前作为访客端使用，不作为受控设备或移动房主。移动访客支持：

- 触摸共享画面；
- 100%–250% 缩放与全屏；
- 覆盖在共享画面上的悬浮控制层，可以边看画面边操作；
- 普通模式和全屏模式始终提供动态方向摇杆、Esc、Space 与 Enter；
- 摇杆可在画面左侧操作区任意落指生成，手指越过半径后底座会继续跟随；
- 全屏摇杆与安全区、屏幕边角保持额外距离；
- 可为当前设备选择最多 12 个自定义游戏按键，配置保存在浏览器本地；
- Esc、Space、Enter 和自定义悬浮键使用原生 Pointer Event 热路径；
- 可展开完整触屏模拟键盘，包括字母、数字、Shift、Tab、修饰键和退格；
- 方向键与动作键按下时发送 `key-down`、松开时发送 `key-up`，可以持续按住；
- 手机系统输入法作为 Unicode 文字输入补充通道。

移动端也必须先被房主批准为操作者，并等待房主完成校准和启用控制。

## 本地部署与手动开发

安装依赖：

```powershell
Set-Location D:\projects\mutiny
npm ci
Copy-Item .env.example .env.local
```

默认本地配置：

```dotenv
NEXT_PUBLIC_SIGNAL_URL=ws://127.0.0.1:8787
SIGNAL_HOST=127.0.0.1
SIGNAL_PORT=8787
HOST_RELAY_URL=http://localhost:3000/
HOST_START_DEV=true
HOST_CDP_PORT=9222
HOST_COMPANION_PORT=8765
```

手动启动网页与信令：

```powershell
npm run dev
```

另开一个终端启动应用控制助手：

```powershell
npm run companion:arm
```

也可以分别启动：

```powershell
npm run dev:web
npm run dev:signal
```

同一局域网测试时，可以让信令和网页监听局域网地址，但只应在可信网络中开放：

```dotenv
NEXT_PUBLIC_SIGNAL_URL=ws://HOST_LAN_IP:8787
SIGNAL_HOST=0.0.0.0
```

```powershell
npm run dev:signal
npm run dev:web -- --host 0.0.0.0
```

不要向局域网或公网暴露 `8765` 和 `9222`。

## 常用端口

| 端口 | 用途 | 公网策略 |
| --- | --- | --- |
| `3000` | 网页 | 只通过 HTTPS 反向代理暴露 |
| `8787` | WebSocket 信令 | 只通过同域 `/signal` 代理 |
| `8790` | 本地 Ruffle/Flash 播放器 | 不暴露 |
| `8765` | 房主应用控制助手 | 只监听 `127.0.0.1` |
| `9222` | Chromium CDP | 只监听 `127.0.0.1` |

## 远端部署

远端服务器只负责网页、信令和 TURN。应用控制助手必须运行在房主电脑的可见桌面会话中。

公网部署需要：

1. 有效 HTTPS；
2. 同域 WSS `/signal`；
3. 可用 TURN；
4. 不向公网开放 `8765` 和 `9222`；
5. 远端页面与本地 companion 协议兼容。

### Linux VPS + Caddy

```bash
npm ci
npm run build
```

生产环境建议：

```dotenv
NEXT_PUBLIC_SIGNAL_URL=
SIGNAL_HOST=127.0.0.1
SIGNAL_PORT=8787
WEB_PORT=3000
```

`NEXT_PUBLIC_SIGNAL_URL` 留空时，页面会连接同域 `/signal`。

```caddyfile
relay.example.com {
    @signal path /signal
    reverse_proxy @signal 127.0.0.1:8787
    reverse_proxy 127.0.0.1:3000
}
```

也可以使用仓库中的 `scripts/start-lan.mjs` 和 `deploy/mutiny-relay.service`，通过一个本机入口同时承载网页与 `/signal`：

```dotenv
SIGNAL_HOST=127.0.0.1
SIGNAL_PORT=8787
WEB_PORT=3000
LAN_HOST=0.0.0.0
LAN_HTTPS_PORT=3443
LAN_TLS_KEY=/absolute/path/server.key
LAN_TLS_CERT=/absolute/path/server.crt
PUBLIC_HTTP_HOST=127.0.0.1
PUBLIC_HTTP_PORT=3080
```

```bash
npm run start:lan
```

systemd 模板包含 `NODE_OPTIONS=--no-network-family-autoselection`。这是为了避免部分只有 IPv4 可用的 VPS 在 Node 地址族竞速时让 Cloudflare TURN API 请求超时。

### SSH release + systemd + Sakura FRP

当前完整服务使用 SSH 发布到 Linux 主机，由用户级 systemd 管理。Sakura FRP 只把公网 HTTPS/WSS 流量转发到服务器回环地址；房主电脑上的 companion、CDP 和 Windows 输入宿主不会部署到服务器。

```text
访客 HTTPS / WSS
  -> Sakura FRP 公网入口
  -> 服务器 127.0.0.1:3080
  -> scripts/start-lan.mjs
     -> 网页 127.0.0.1:3000
     -> 信令 127.0.0.1:8787 (/signal)
```

发布采用不可变 release 目录和软链接切换。部署前先提交经过验证的源码，不把工作区、`.env.local`、TLS 私钥或 TURN 长期凭据打包进去。

本地 PowerShell：

```powershell
npm run lint
npm test

$Release = (git rev-parse --short HEAD).Trim()
$DeployTarget = "user@server"
$DeployKey = "$env:USERPROFILE\.ssh\mutiny_deploy_ed25519"
$Archive = ".deploy-cache\mutiny-$Release.tar.gz"

git archive --format=tar.gz --output=$Archive $Release
scp -i $DeployKey $Archive "$DeployTarget`:/home/user/apps/mutiny-$Release.tar.gz"
```

服务器端为新版本建立独立目录、恢复共享配置并构建。下面的 `/home/user` 应按实际 systemd 模板修改；仓库自带模板目前使用具体部署用户路径，复制到其他服务器前必须调整。

```bash
RELEASE=<git-short-sha>
APP_ROOT=/home/user/apps
RELEASE_DIR="$APP_ROOT/mutiny-relay-releases/$RELEASE"
SHARED_DIR="$APP_ROOT/mutiny-relay-shared"

mkdir -p "$RELEASE_DIR"
tar -xzf "$APP_ROOT/mutiny-$RELEASE.tar.gz" -C "$RELEASE_DIR"
ln -s "$SHARED_DIR/tls" "$RELEASE_DIR/tls"
ln -s "$SHARED_DIR/turn.env" "$RELEASE_DIR/deploy/turn.env"

cd "$RELEASE_DIR"
export PATH="$HOME/.local/node-v22.17.0-linux-x64/bin:$PATH"
npm ci --no-audit --no-fund
npm run build
```

只有新 release 构建成功后才切换当前链接：

```bash
APP_ROOT=/home/user/apps
RELEASE=<git-short-sha>
CURRENT="$APP_ROOT/mutiny-relay"
NEXT="$APP_ROOT/mutiny-relay-releases/$RELEASE"
OLD="$(readlink -f "$CURRENT")"

ln -sfn "$NEXT" "$APP_ROOT/mutiny-relay.next"
mv -Tf "$APP_ROOT/mutiny-relay.next" "$CURRENT"
systemctl --user restart mutiny-relay

systemctl --user is-active mutiny-relay
curl -fsS http://127.0.0.1:3080/free > /dev/null
```

切换后还要从服务器外检查公网入口，并在浏览器实际创建/加入房间来验证同域 WebSocket。当前 HTTP 健康检查：

```bash
curl -f https://www.u3690784.nyat.app:64515/free
```

如果重启或健康检查失败，立刻把软链接切回 `$OLD` 并再次重启服务：

```bash
ln -sfn "$OLD" "$APP_ROOT/mutiny-relay.rollback"
mv -Tf "$APP_ROOT/mutiny-relay.rollback" "$CURRENT"
systemctl --user restart mutiny-relay
```

Sakura FRP 隧道的目标应是服务器 `127.0.0.1:3080`，并允许 WebSocket 升级，使页面和 `/signal` 保持同源。不要把 `8765`、`9222`、TLS 私钥或 TURN 长期凭据交给 FRP 或直接暴露到公网。旧 release 至少保留一个版本，以便完成上述回滚。

### OpenAI Sites / Cloudflare Worker

项目保留 `.openai/hosting.json` 和 vinext Worker 构建。当前 Worker 只承载页面和静态资源，没有把 `server/signaling.mjs` 改写为 Worker WebSocket 服务，因此单独部署 Sites 不是完整的 Mutiny Relay；仍需要独立 WSS 信令与 TURN，或实现 Durable Object 信令。

## TURN 配置

公网、运营商 NAT、校园/公司网络和严格防火墙环境应配置 TURN。本地同机测试通常可以只使用 STUN。

Cloudflare Realtime TURN 服务端配置：

```dotenv
CLOUDFLARE_TURN_KEY_ID=your_key_id
CLOUDFLARE_TURN_API_TOKEN=your_api_token
TURN_TTL_SECONDS=3600
CONTROL_LEASE_SECONDS=90
```

也可以使用静态 TURN：

```dotenv
STUN_URLS=stun:turn.example.com:3478
TURN_URLS=turn:turn.example.com:3478?transport=udp,turn:turn.example.com:3478?transport=tcp,turns:turn.example.com:5349?transport=tcp
TURN_USERNAME=your_username
TURN_CREDENTIAL=your_credential
```

状态含义：

- `仅 STUN`：未配置 TURN；
- `TURN 已就绪`：信令已返回可用 TURN 配置；
- `P2P 直连`：媒体没有经过中继；
- `TURN 中继`：媒体经过 TURN；
- `TURN 凭据获取失败，已回退到 STUN`：服务端换取临时凭据失败。

TURN 与 companion 是独立链路。TURN 故障不会造成助手版本错误；companion 故障也不会改变 ICE/TURN 状态。

## 当前能力与实现

- 分享浏览器标签页、Windows 应用窗口或整个屏幕；
- 房间创建后可原位更换共享窗口，不改变房间码或访客连接；
- 目标捕获帧率 `30 FPS`，动态内容使用 `motion` 提示；
- WebRTC 发送端使用 `maintain-framerate`，带宽不足时优先保持帧率；
- 音频与视频使用独立单轨媒体流和不同接收缓冲目标，优先保证操作画面低延迟；
- WebRTC DTLS/SRTP 媒体传输；
- 可靠、有序的 RTCDataChannel 控制消息，保证 `key-down` 和 `key-up` 顺序；
- 6 位房间码、逐人批准、操作者与观众权限；
- 校准、重试、取消和启用控制全部由房主发起；
- Windows 应用自动边界映射与扫描码键盘输入；
- Chromium 标签页两点校准与虚拟输入；
- 延迟、码率、帧率、丢包、音频缓冲、解码和媒体路径统计；
- 访客缩放、全屏、动态跟随摇杆、低延迟悬浮按键和手机软键盘；
- 最多 8 位测试成员；
- 断线、权限降级、指针取消、页面隐藏、租约超时和助手重连后的安全收回；
- companion v5/v6 协议协商。

媒体架构目前是 mesh：房主会为每位访客上传一路视频，适合少量参与者；大房间需要 SFU。

## 工作原理

1. 房主调用 `getDisplayMedia()`，由浏览器显示系统共享选择器。
2. 房主为每位访客建立独立 `RTCPeerConnection`。
3. 音频轨和视频轨分别放入独立的单轨 `MediaStream`，访客也分别接入 `<audio>` 和 `<video>`，避免共享同步组强制视频等待音频。
4. 访客通过可靠有序的 DataChannel 发送指针、按键按下和按键抬起事件。
5. 手机悬浮键在原生 `pointerdown` 中立即进入同一控制通道；摇杆只在方向跨过死区时改变按键状态。
6. 房主页面把获准事件转发给只监听 `127.0.0.1:8765` 的 companion。
7. Chromium 目标使用 CDP 虚拟输入；Windows 应用使用 User32/DWM 与 `SendInput`。

信令服务只在内存中保存房间、权限和控制状态，不接收或保存媒体画面。信令重启后，现有房间立即失效。

## 改进过程与问题修复记录

### 低延迟媒体改进过程

1. 先把网络 RTT 与端到端画面延迟分开：RTT 只有 5 ms 并不代表采集、编码、接收缓冲、解码和显示也只有 5 ms。
2. 增加 `captureTime`、接收抖动缓冲、最低/目标缓冲、平均解码时间、冻结、NACK、PLI 和最近 2 秒丢包等指标，避免只凭码率与 FPS 判断。
3. 增加低延迟、720p/60 和 1080p/30 三个发送档位，并优先协商 H.264；固定最高码率只是上限控制，不等同于固定端到端延迟。
4. 实测发现不共享音频时视频可明显降低，而共享音频时移动端会形成 200 ms 以上缓冲，因此将音频与视频拆为不同同步组：视频目标缓冲为 0，音频允许更高缓冲。
5. 控制消息继续使用可靠有序通道。画面补帧、subtick 或客户端预测无法让远端应用更早接收到真实按键，也可能制造“画面预测与主机状态不一致”，所以本轮优先消除事件与播放链路中的真实等待。

### 移动端操控改进过程

1. 原摇杆使用 `static` 模式，命中区域只有约 `124 × 124 px`；手指稍微偏离圆盘就无法开始控制。
2. 对比开源实现后保留已安装的 `nipplejs`，把模式改为 `dynamic + follow`，并把透明命中区扩大到画面左侧约 46%，中间和右侧仍可用于远程页面滑动。
3. 降低摇杆方向死区和事件阈值，让小幅转向更快进入方向状态；全屏时增加 safe-area 与边角距离。
4. 虚拟动作键原本已经在 `pointerdown` 发送，但仍经过 React 合成事件，按下视觉只依赖 CSS `:active`。现在使用本地 `LowLatencyTouchButton` 注册原生监听，并直接写入 `data-pressed` 提供即时反馈。
5. 释放路径同时覆盖目标元素、window 捕获、`pointercancel`、`lostpointercapture`、窗口失焦和页面隐藏；按键传输仍可靠有序，避免重新引入卡键。
6. 长按菜单通过非被动 `touchstart`、`contextmenu`、`selectstart`、`dragstart` 与跨浏览器 user-select/touch-callout 样式共同抑制。


| 现象 | 根因 | 处理 |
| --- | --- | --- |
| 应用窗口只有个位数 FPS | 文字窗口被编码器按细节优先处理 | 视频轨使用 `motion`，发送端使用 `maintain-framerate`，捕获与发送限制为 30 FPS |
| 第一次方向键有效，后续无反应；Enter 不触发 | 控制通道原来无序且不重传，`key-up` 可能丢失或乱序 | 改为可靠有序 DataChannel，保证完整按键周期 |
| 房主端显示按键但游戏没反应 | 页面只证明 `key-down` 到达，不能证明 `key-up` 正常 | 增加通道顺序回归测试，并检查原生扩展扫描码 |
| TURN 部署后 `fetch failed` | VPS 的 Node IPv4/IPv6 自动竞速选择了不可达路径 | systemd 固化 `--no-network-family-autoselection` |
| TURN 中继延迟约 1 秒、帧率个位数 | 房主 VPN 改变了路由与中继路径 | 关闭 VPN 后恢复约 10 ms、25–30 FPS |
| 网络 RTT 只有几毫秒但画面明显滞后 | RTT 只测网络往返，不包含采集、编码、抖动缓冲、解码和显示；音视频同步也可能抬高缓冲 | 单独显示画面延迟、音频缓冲与接收统计；视频请求 0 ms、音频请求 80 ms `jitterBufferTarget`，并显示最近 2 秒丢包增量 |
| 手机缓冲长期高于桌面浏览器 | 移动端的解码能力、节能策略或播放缓冲下限更高；高分辨率/码率也可能造成解码或网络队列积压 | 房主优先选择“低延迟”档位（720p/30、最高 3.5 Mbps、H.264 优先），并对比实际/最低/目标缓冲、解码、冻结与 NACK；需要更顺滑且链路有余量时再选择 720p/60 |
| 手机长按虚拟键弹出复制/剪切菜单 | 移动浏览器把按键文字当作可选择内容并触发系统 callout | 同时阻止 `contextmenu`、拖拽、文本选择、touch callout 与点击高亮 |
| 开启音频后视频缓冲稳定在 200 ms 以上 | 音视频共用同步组时，浏览器可能为了音画同步让低延迟视频等待高缓冲音频 | 每条媒体轨使用独立单轨 `MediaStream`，分别挂载到 `<video>` 和 `<audio>`；允许音频比视频更晚播放 |
| 摇杆必须准确按中，稍微偏移就失效 | `static` 摇杆的实际命中区只有圆盘大小 | 改用 `dynamic + follow`，扩大左侧透明操作区并降低方向死区 |
| 虚拟动作键比主机键盘更“肉” | 手机触控仍经过合成事件和浏览器默认手势仲裁，视觉反馈也依赖 `:active` | 原生 `pointerdown` 立即发送、Pointer Capture 保持连续手势、直接 DOM 按下态反馈，并使用非被动 touch 监听 |
| 松开虚拟键后偶尔仍持续按下 | 指针取消、捕获丢失、页面隐藏或失焦时可能没有经过按钮自己的 `pointerup` | 为所有退出路径补发释放，并在停控、断线和权限变化时统一清空已按键集合 |
| 旧版助手提示持续出现 | 公网页面与本地助手协议版本不一致 | 增加 v5/v6 协议协商，并要求更新后重启整套环境 |
| Windows 鼠标明显偏移 | 共享对象、窗口边界、显示器或 DPI 映射不一致 | 区分窗口/显示器映射，读取 DWM 边界并启用每显示器 DPI 感知 |
| 校准窗口被覆盖后远端无法重试 | 校准权分散在远端，房主状态与目标窗口不同步 | 校准生命周期收回房主端，自动置前目标并支持房主重试/取消 |
| `target.send is not a function` | 原生窗口目标走入 CDP 清理路径 | 对 CDP 与原生目标分流 |
| Chromium 调试端口 `fetch failed` | `9222` 没有专用 Chromium | Windows 原生目标不再依赖 CDP；标签页控制仍要求调试端口 |

## 常见问题

| 现象 | 检查与处理 |
| --- | --- |
| 页面打不开 | 本地检查 `http://localhost:3000/`；公网检查 HTTPS 入口 |
| 无法创建或加入房间 | 检查 `8787` 及公网 `/signal` WebSocket 代理 |
| 只有画面不能控制 | 确认房主已批准操作者、连接助手、选择目标、完成校准并启用控制 |
| 助手授权码无效 | 使用本次启动终端的新授权码，不要输入房间码 |
| 提示旧版助手 | 结束旧环境后重新运行 `start-host.cmd`，并确认远端页面已更新 |
| 看不到 Windows 应用 | 打开且不要最小化目标，从房主可见桌面运行助手并刷新列表 |
| 无法置前窗口 | 房主本地点击一次目标，移除遮挡，并确保权限级别一致 |
| 鼠标偏移 | 两处选择同一窗口；改变共享目标、显示器或缩放后重新校准 |
| 页面显示按键但应用无反应 | 重启最新助手；检查应用权限与反作弊限制 |
| 公网延迟突然升高 | 关闭 VPN 对比，检查当前是 P2P 还是 TURN，并检查 TURN 区域 |
| `EADDRINUSE` | 不要重复启动；在原启动终端按 `Ctrl+C` 后再运行 |
| 静止应用 FPS 较低 | 在持续滚动或动画期间观察；静态内容可能只发送变化帧 |

## Mutiny / Flash 本地播放器

播放器与远程控制相互独立。项目不会下载或分发游戏文件，只使用你合法取得并放在项目根目录的 `mutiny.swf`。

双击：

```text
start-flash-player.cmd
```

或运行：

```powershell
npm run flash:start
```

手动流程：

```powershell
npm run mutiny:extract
npm run mutiny:patch
npm run mutiny:local
```

播放器地址为 [http://127.0.0.1:8790/](http://127.0.0.1:8790/)。原始、提取和补丁 SWF 不应上传到公网或提交到仓库。

## 开源组件与参考实现

| 项目 | 在 Mutiny Relay 中的角色 | 采用情况 |
| --- | --- | --- |
| [nipplejs](https://github.com/yoannmoinet/nipplejs) | 支持 `dynamic`、`semi`、`static` 与 `follow` 的移动摇杆 | 运行时依赖，当前固定为 `1.0.4`；本轮直接使用其动态跟随能力 |
| [simple-keyboard](https://github.com/hodgef/simple-keyboard) | 浏览器完整虚拟键盘及按下/释放回调 | 通过 `react-simple-keyboard` 运行时依赖使用 |
| [virtual-gamepad-lib](https://github.com/KW-M/virtual-gamepad-lib) | 原生 `pointerdown`、Pointer Capture、`pointercancel` 与非被动 `touchstart` 的事件生命周期参考 | 只参考 [GamepadEmulator.ts](https://github.com/KW-M/virtual-gamepad-lib/blob/main/src/GamepadEmulator.ts) 的设计，没有引入完整 Gamepad API 模拟层 |
| [Mana Potion](https://github.com/verekia/manapotion) | `follow` 摇杆与 headless 控件方案对比 | 已评估但未引入；仅为一个摇杆增加整套游戏工具链不划算 |
| [virtual-joystick](https://github.com/dondido/virtual-joystick) | 固定、半动态和动态 Web Component 摇杆方案对比 | 已评估但未引入；现有 `nipplejs` 能以更小迁移风险满足需求 |
| [Ruffle](https://github.com/ruffle-rs/ruffle) | 本地 Flash 播放器 | 项目已有运行时依赖，与远程控制链路独立 |

“参考”表示借鉴公开的事件模型和 API 取舍，不表示把这些仓库的完整实现复制进项目。Mutiny Relay 的悬浮按键最终仍发送键盘 `key-down`/`key-up`，而不是模拟 `navigator.getGamepads()`；因此没有引入完整虚拟手柄库。


## 项目结构

```text
app/
  relay-room.tsx            WebRTC, capture, control and room UI
  free/page.tsx             Remote collaboration route
  globals.css               Desktop and mobile styles

companion/
  server.mjs                Local authorization and input routing
  windows-native.mjs        Native host adapter
  windows-native-host.ps1   Window enumeration and User32 input

server/
  signaling.mjs             Rooms, permissions, ICE and TURN
  lan-proxy.mjs             HTTPS/WSS reverse proxy

scripts/
  start-everything.mjs      Full host environment and cleanup
  start-host.mjs            Lightweight host launcher
  start-lan.mjs             Production relay launcher
  cleanup-watchdog.mjs      Abnormal-exit cleanup

start-host.cmd              General host one-click entry
local-test.cmd              Developer local test entry
start-flash-player.cmd      Local Flash player entry
deploy/                     systemd and TURN templates
tests/                      Rendering, signaling and input tests
```

## 开发与验证

```powershell
npm run host:check
npm run flash:check
npm run lint
npm test
```

`npm test` 会先执行生产构建，再运行页面渲染、输入助手和信令/控制状态测试。批处理脚本还会检查文件名和内容是否保持 ASCII。

## 隐私与安全

- 每次分享前都由房主在系统选择器中明确选择目标；
- 媒体和 DataChannel 使用 DTLS/SRTP；
- 信令不保存媒体画面；
- companion、CDP 和 Windows 原生宿主只应在可信房主电脑运行；
- `8765`、`9222`、TURN 长期密钥和 TLS 私钥不得暴露给访客；
- 只向可信访客授予操作权限；
- Windows 原生模式会移动系统鼠标，不会锁定房主本地输入；
- 关闭房间、停止共享或结束启动器会撤销媒体与远程输入；
- 不要在专用调试 Chromium 中登录邮箱、支付或管理后台；
- 不要提交 `.env.local`、`deploy/turn.env` 或任何长期凭据。

## 已知边界

- Windows 原生应用控制目前只支持 Windows 房主；
- 手机和平板目前只能作为访客；
- macOS/Linux 普通应用的原生输入桥接尚未实现；
- 系统安全桌面、UAC 提示和更高权限窗口不能被普通助手控制；
- 反作弊或驱动级输入应用可能拒绝注入；
- 多人媒体仍是 mesh，大房间需要 SFU；
- Sites Worker 尚不包含可独立运行的 WebSocket 信令；
- 实际性能取决于网络、路由、捕获目标、编码器和房主硬件。

## 技术栈

- React 19 / TypeScript 5
- vinext / Vite 8
- WebRTC / RTCDataChannel
- Node.js WebSocket
- Chrome DevTools Protocol
- Windows User32 / DWM / `SendInput`
- Cloudflare Realtime TURN
- Cloudflare Worker / OpenAI Sites