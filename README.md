# Mutiny Relay

一个面向《Mutiny》等回合制网页游戏的远程同屏联机原型。房主在浏览器中分享游戏窗口，访客通过 WebRTC 直接观看画面，并把鼠标位置、点击和键盘操作提示发送给房主。

> 本项目不包含 Nitrome 的游戏代码、美术、音乐或关卡资源，也不是 Nitrome 的官方项目。它只是一个独立的屏幕分享与远程指令实验。

## 当前能力

- 分享浏览器标签页、窗口或整个屏幕；
- 通过 WebRTC 进行端到端加密的点对点音视频传输；
- 不需要注册账号或业务数据库；
- 通过复制、粘贴邀请文本完成连接，不依赖信令服务器；
- 访客可发送鼠标位置、点击和键盘按键；
- 房主端会显示访客的远程指针和最近一次操作；
- 支持桌面与移动端的响应式界面。

## 重要限制

浏览器网页不能直接控制操作系统中的真实鼠标和键盘。因此，当前版本发送的是“操作指令”：房主能够看到访客指向的位置、点击和按键提示，但这些指令不会自动注入另一个浏览器标签页或 Flash/HTML5 游戏窗口。

若要实现真正的远程控制，需要增加一个经过用户授权的桌面辅助程序，由它接收 WebRTC DataChannel 指令并调用系统输入接口。另一种方案是把能够修改的游戏直接嵌入本项目，在游戏内部消费这些指令。

此外，目前只配置了公共 STUN 服务。部分公司网络、校园网、运营商 NAT 或严格防火墙环境无法建立直接连接；正式使用时应部署 TURN 服务作为中继。

## 工作原理

项目使用两条 WebRTC 通道：

1. **MediaStream**：房主调用 `getDisplayMedia()` 获取用户选择的画面和音频，然后将媒体轨道加入 `RTCPeerConnection`。
2. **RTCDataChannel**：访客把归一化后的鼠标坐标、点击和按键事件发送给房主。

连接过程如下：

```text
房主浏览器                         访客浏览器
    │                                  │
    ├─ 选择共享窗口                    │
    ├─ 创建 WebRTC Offer               │
    ├─ 复制邀请文本 ──────────────────>│
    │                                  ├─ 创建 WebRTC Answer
    │<────────────────── 复制回应文本 ─┤
    ├─ 设置 Answer                     │
    │                                  │
    ├════ 加密视频/音频（WebRTC）══════>│
    │<══ 鼠标、点击、按键（DataChannel）┤
```

邀请和回应文本是经过 Base64 编码的 WebRTC SDP，其中包含临时的媒体、网络和 ICE 协商信息，不包含游戏画面。因为当前采用手工交换 SDP，应用服务器不参与连接匹配，也不会保存对局内容。

## 项目组成

```text
app/
├─ page.tsx          主界面、WebRTC 协商、屏幕捕获和指令传输
├─ globals.css       页面样式与响应式布局
├─ layout.tsx        页面元数据及社交分享配置
└─ chatgpt-auth.ts   Sites 模板提供的可选登录辅助，目前未使用

public/
├─ og.png            社交分享预览图
└─ favicon.svg       站点图标

worker/index.ts      Cloudflare Worker 入口
vite.config.ts       vinext、Vite、Cloudflare 与 Sites 插件配置
.openai/hosting.json OpenAI Sites 部署配置
db/、drizzle/        模板预留的数据层，目前原型不使用数据库
```

核心功能集中在 `app/page.tsx`，当前没有单独的信令服务、用户系统、房间数据库或游戏服务端。

## 运行环境

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

`localhost` 被浏览器视为安全上下文，因此本地开发时可以调用屏幕分享接口。

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

### 方案二：Cloudflare Workers / OpenAI Sites

本项目的 vinext 构建目标原生兼容 Cloudflare Worker，目前也已包含 OpenAI Sites 配置。这条路线无需维护 VPS，但使用其他账号或项目部署时，应修改或重新生成 `.openai/hosting.json` 中的站点项目配置，不要复用现有 `project_id`。

### TURN 服务

如果两位玩家经常无法连接，可在自己的服务器上部署 coturn，并把 `app/page.tsx` 中的 `iceServers` 扩展为自己的 STUN/TURN 地址：

```ts
const rtcConfig: RTCConfiguration = {
  iceServers: [
    { urls: "stun:turn.example.com:3478" },
    {
      urls: "turn:turn.example.com:3478",
      username: "临时用户名",
      credential: "临时凭据",
    },
  ],
};
```

不要把长期有效的 TURN 密码直接提交到公开仓库。正式环境应由后端签发短期 TURN 凭据。TURN 会中继无法直连的音视频，因此服务器带宽消耗可能明显增加。

## 隐私与安全

- 浏览器会在每次分享前要求房主明确选择窗口或屏幕；
- WebRTC 媒体和 DataChannel 使用 DTLS/SRTP 加密；
- 当前项目不会把 SDP、画面或操作记录写入数据库；
- 邀请文本包含临时网络信息，只应发送给准备加入本次连接的人；
- 停止浏览器的屏幕分享或退出房间即可关闭媒体轨道和连接。

## 下一步建议

- 增加 WebSocket 信令服务，用短房间码代替复制粘贴长文本；
- 部署 TURN，提高复杂网络环境下的连接成功率；
- 增加桌面辅助程序，实现经过授权的真实输入注入；
- 增加房主确认、访客权限开关和只读观战模式；
- 添加连接质量、延迟、码率和丢包统计；
- 为多人观战引入 SFU，而不是让房主分别向每位观众上传视频。

## 技术栈

- React 19
- TypeScript 5
- vinext
- Vite 8
- WebRTC
- Cloudflare Workers / OpenAI Sites

## 许可证与游戏资源

仓库当前未声明开源许可证。在公开分发或接受外部贡献前，应选择合适的许可证。请勿把 Nitrome 的受版权保护代码、游戏文件、美术、音乐或商标资源直接加入本仓库，除非已经获得相应授权。
