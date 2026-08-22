"use client";

/* eslint-disable @next/next/no-html-link-for-pages -- vinext 1.0 beta 的 Link 在生产环境会触发 RSC 预取异常。 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import Keyboard from "react-simple-keyboard";

type AppRole = "host" | "guest" | null;
type PeerRole = "controller" | "spectator";
type Peer = { peerId: string; name: string; role: PeerRole; approved: boolean };
type RemoteEvent = { type: "pointer" | "pointer-down" | "pointer-up" | "click" | "key" | "key-down" | "key-up" | "text"; x?: number; y?: number; button?: number; buttons?: number; key?: string; code?: string; keyCode?: number; location?: number; repeat?: boolean; altKey?: boolean; ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean; text?: string };
type ControlTarget = { id: string; title: string; url: string; kind: "browser" | "window"; width?: number; height?: number };
type Quality = { rtt: number | null; videoDelay: number | null; jitterBuffer: number | null; jitterBufferMinimum: number | null; jitterBufferTarget: number | null; decodeTime: number | null; bitrate: number; fps: number | null; lost: number };
type VideoProfileKey = "low-latency" | "smooth" | "quality";
type VideoProfile = { label: string; detail: string; width: number; height: number; frameRate: number; maxBitrate: number };
type IceServerMessage = { type: "ice-servers"; iceServers: RTCIceServer[]; turnEnabled: boolean; error?: string | null };
type ControlState = { ownerPeerId: string; ownerName: string; mode: "free"; calibrationReady: boolean; calibrationStep: "off" | "point-1" | "point-2" | "complete"; calibrationMessage: string | null; phase: "setup" | "calibration" | "ready" | "playing"; leaseUntil: number };
type WebRtcVideoFrameMetadata = VideoFrameCallbackMetadata & { captureTime?: number; receiveTime?: number };
type LowLatencyReceiver = RTCRtpReceiver & { jitterBufferTarget?: number | null; playoutDelayHint?: number | null };

const configuredSignalUrl = process.env.NEXT_PUBLIC_SIGNAL_URL;
const videoProfiles: Record<VideoProfileKey, VideoProfile> = {
  "low-latency": { label: "低延迟", detail: "720p · 30 fps · 最高 2.5 Mbps", width: 1280, height: 720, frameRate: 30, maxBitrate: 2_500_000 },
  smooth: { label: "高帧率", detail: "720p · 60 fps · 最高 5 Mbps", width: 1280, height: 720, frameRate: 60, maxBitrate: 5_000_000 },
  quality: { label: "高清晰度", detail: "1080p · 30 fps · 最高 6 Mbps", width: 1920, height: 1080, frameRate: 30, maxBitrate: 6_000_000 },
};


type VirtualKey = { key: string; code: string; keyCode: number; shiftKey?: boolean };

const virtualKeyboardLayout = {
  default: [
    "1 2 3 4 5 6 7 8 9 0 {bksp}",
    "q w e r t y u i o p",
    "a s d f g h j k l {enter}",
    "{shift} z x c v b n m , . /",
    "{esc} {arrowleft} {arrowup} {arrowdown} {arrowright} {space}",
  ],
  shift: [
    "! @ # $ % ^ & * ( ) {bksp}",
    "Q W E R T Y U I O P",
    "A S D F G H J K L {enter}",
    "{shift} Z X C V B N M < > ?",
    "{esc} {arrowleft} {arrowup} {arrowdown} {arrowright} {space}",
  ],
};

const namedVirtualKeys: Record<string, VirtualKey> = {
  "{bksp}": { key: "Backspace", code: "Backspace", keyCode: 8 },
  "{tab}": { key: "Tab", code: "Tab", keyCode: 9 },
  "{enter}": { key: "Enter", code: "Enter", keyCode: 13 },
  "{ctrl}": { key: "Control", code: "ControlLeft", keyCode: 17 },
  "{alt}": { key: "Alt", code: "AltLeft", keyCode: 18 },
  "{esc}": { key: "Escape", code: "Escape", keyCode: 27 },
  "{space}": { key: " ", code: "Space", keyCode: 32 },
  "{shiftkey}": { key: "Shift", code: "ShiftLeft", keyCode: 16 },
  "{arrowleft}": { key: "ArrowLeft", code: "ArrowLeft", keyCode: 37 },
  "{arrowup}": { key: "ArrowUp", code: "ArrowUp", keyCode: 38 },
  "{arrowright}": { key: "ArrowRight", code: "ArrowRight", keyCode: 39 },
  "{arrowdown}": { key: "ArrowDown", code: "ArrowDown", keyCode: 40 },
};

const customVirtualKeyOptions = [
  ..."qwertyuiopasdfghjklzxcvbnm".split("").map((button) => ({ button, label: button.toUpperCase() })),
  ..."1234567890".split("").map((button) => ({ button, label: button })),
  { button: "{tab}", label: "TAB" },
  { button: "{shiftkey}", label: "SHIFT" },
  { button: "{ctrl}", label: "CTRL" },
  { button: "{alt}", label: "ALT" },
  { button: "{bksp}", label: "⌫" },
];

const customVirtualKeyLabels = Object.fromEntries(customVirtualKeyOptions.map(({ button, label }) => [button, label]));
const customVirtualKeysStorageKey = "mutiny.mobile-control-keys.v1";

const punctuationKeys: Record<string, { code: string; keyCode: number }> = {
  ";": { code: "Semicolon", keyCode: 186 }, "=": { code: "Equal", keyCode: 187 },
  ",": { code: "Comma", keyCode: 188 }, "-": { code: "Minus", keyCode: 189 },
  ".": { code: "Period", keyCode: 190 }, "/": { code: "Slash", keyCode: 191 },
  "`": { code: "Backquote", keyCode: 192 }, "[": { code: "BracketLeft", keyCode: 219 },
  "\\": { code: "Backslash", keyCode: 220 }, "]": { code: "BracketRight", keyCode: 221 },
  "'": { code: "Quote", keyCode: 222 },
  ":": { code: "Semicolon", keyCode: 186 }, "+": { code: "Equal", keyCode: 187 },
  "<": { code: "Comma", keyCode: 188 }, "_": { code: "Minus", keyCode: 189 },
  ">": { code: "Period", keyCode: 190 }, "?": { code: "Slash", keyCode: 191 },
  "~": { code: "Backquote", keyCode: 192 }, "{": { code: "BracketLeft", keyCode: 219 },
  "|": { code: "Backslash", keyCode: 220 }, "}": { code: "BracketRight", keyCode: 221 },
  "\"": { code: "Quote", keyCode: 222 },
};

function virtualKey(button: string): VirtualKey | null {
  if (namedVirtualKeys[button]) return namedVirtualKeys[button];
  if (button.length !== 1) return null;
  const upper = button.toUpperCase();
  if (/^[A-Z]$/.test(upper)) return { key: button, code: "Key" + upper, keyCode: upper.charCodeAt(0), shiftKey: button === upper };
  if (/^[0-9]$/.test(button)) return { key: button, code: "Digit" + button, keyCode: button.charCodeAt(0) };
  const shiftedDigits = ")!@#$%^&*(";
  const shiftedIndex = shiftedDigits.indexOf(button);
  if (shiftedIndex >= 0) return { key: button, code: "Digit" + shiftedIndex, keyCode: 48 + shiftedIndex, shiftKey: true };
  const punctuation = punctuationKeys[button];
  return punctuation ? { key: button, ...punctuation, shiftKey: ":+<_>?~{|}\"".includes(button) } : null;
}

function signalUrl() {
  if (configuredSignalUrl) return configuredSignalUrl;
  if (typeof window === "undefined") return "ws://127.0.0.1:8787";
  if (["localhost", "127.0.0.1", "[::1]"].includes(window.location.hostname) && window.location.port === "3000") {
    return "ws://127.0.0.1:8787";
  }
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/signal`;
}

function list(value: string | undefined, fallback: string[]) {
  return value?.split(",").map((item) => item.trim()).filter(Boolean) ?? fallback;
}

function defaultRtcConfig(): RTCConfiguration {
  const iceServers: RTCIceServer[] = [
    { urls: list(process.env.NEXT_PUBLIC_STUN_URLS, ["stun:stun.l.google.com:19302"]) },
  ];
  const turnUrls = list(process.env.NEXT_PUBLIC_TURN_URLS, []);
  if (turnUrls.length) {
    iceServers.push({
      urls: turnUrls,
      username: process.env.NEXT_PUBLIC_TURN_USERNAME,
      credential: process.env.NEXT_PUBLIC_TURN_CREDENTIAL,
    });
  }
  return { iceServers };
}

async function preferSmoothVideo(sender: RTCRtpSender, profile: VideoProfile) {
  const parameters = sender.getParameters();
  if (!parameters.encodings.length) parameters.encodings = [{}];
  parameters.encodings[0].maxFramerate = profile.frameRate;
  parameters.encodings[0].maxBitrate = profile.maxBitrate;
  (parameters as RTCRtpSendParameters & { degradationPreference?: "maintain-framerate" }).degradationPreference = "maintain-framerate";
  try {
    await sender.setParameters(parameters);
  } catch (error) {
    console.warn("无法启用帧率优先编码，将继续使用浏览器默认设置。", error);
  }
}

function preferLowLatencyPlayback(receiver: RTCRtpReceiver) {
  const configurable = receiver as LowLatencyReceiver;
  try {
    if ("jitterBufferTarget" in configurable) configurable.jitterBufferTarget = 20;
  } catch (error) {
    console.warn("无法设置标准接收缓冲目标，将继续尝试浏览器兼容接口。", error);
  }
  try {
    if ("playoutDelayHint" in configurable) configurable.playoutDelayHint = 0;
  } catch (error) {
    console.warn("无法设置兼容播放延迟提示，将继续使用浏览器默认值。", error);
  }
}

async function selectDisplayStream(includeAudio: boolean, profile: VideoProfile) {
  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: { frameRate: { ideal: profile.frameRate, max: profile.frameRate }, width: { ideal: profile.width, max: profile.width }, height: { ideal: profile.height, max: profile.height }, displaySurface: "window" },
    audio: includeAudio,
  });
  const videoTrack = stream.getVideoTracks()[0];
  if (!videoTrack) {
    stream.getTracks().forEach((track) => track.stop());
    throw new Error("没有获得可共享的视频轨道");
  }
  try {
    videoTrack.contentHint = "motion";
    await videoTrack.applyConstraints({ frameRate: { ideal: profile.frameRate, max: profile.frameRate }, width: { ideal: profile.width, max: profile.width }, height: { ideal: profile.height, max: profile.height } });
    return stream;
  } catch (error) {
    stream.getTracks().forEach((track) => track.stop());
    throw error;
  }
}

export default function RelayRoom() {
  const [role, setRole] = useState<AppRole>(null);
  const [peerRole, setPeerRole] = useState<PeerRole>("controller");
  const [requestedRole, setRequestedRole] = useState<PeerRole>("controller");
  const [name, setName] = useState("");
  const [shareAudio, setShareAudio] = useState(false);
  const [videoProfile, setVideoProfile] = useState<VideoProfileKey>("low-latency");
  const [joinCode, setJoinCode] = useState("");
  const [roomCode, setRoomCode] = useState("");
  const [status, setStatus] = useState("本地服务未连接");
  const [notice, setNotice] = useState("");
  const [peers, setPeers] = useState<Peer[]>([]);
  const [quality, setQuality] = useState<Quality>({ rtt: null, videoDelay: null, jitterBuffer: null, jitterBufferMinimum: null, jitterBufferTarget: null, decodeTime: null, bitrate: 0, fps: null, lost: 0 });
  const [videoAspect, setVideoAspect] = useState(16 / 9);
  const [remotePointer, setRemotePointer] = useState({ x: 0.5, y: 0.5, visible: false, click: false });
  const [lastCommand, setLastCommand] = useState("等待访客操作");
  const [companionCode, setCompanionCode] = useState("");
  const [companionState, setCompanionState] = useState<"off" | "connecting" | "ready">("off");
  const [desktopControlEnabled, setDesktopControlEnabled] = useState(false);
  const [browserTargets, setBrowserTargets] = useState<ControlTarget[]>([]);
  const [browserTargetId, setBrowserTargetId] = useState("");
  const [browserTargetReady, setBrowserTargetReady] = useState(false);
  const [browserViewport, setBrowserViewport] = useState<{ width: number; height: number } | null>(null);
  const [calibrationState, setCalibrationState] = useState<"off" | "point-1" | "point-2" | "complete">("off");
  const [zoom, setZoom] = useState(1);
  const [connectedPeers, setConnectedPeers] = useState(0);
  const [turnStatus, setTurnStatus] = useState("正在检查 ICE");
  const [mediaPath, setMediaPath] = useState("等待连接");
  const [selfPeerId, setSelfPeerId] = useState("");
  const [control, setControl] = useState<ControlState | null>(null);
  const [isChangingShare, setIsChangingShare] = useState(false);
  const [keyboardLayoutName, setKeyboardLayoutName] = useState<"default" | "shift">("default");
  const [mobileKeyboardOpen, setMobileKeyboardOpen] = useState(false);
  const [mobileKeyEditorOpen, setMobileKeyEditorOpen] = useState(false);
  const [customVirtualKeys, setCustomVirtualKeys] = useState<string[]>([]);

  const roleRef = useRef<AppRole>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const pcsRef = useRef(new Map<string, RTCPeerConnection>());
  const channelsRef = useRef(new Map<string, RTCDataChannel>());
  const peersRef = useRef<Peer[]>([]);
  const candidateQueueRef = useRef(new Map<string, RTCIceCandidateInit[]>());
  const companionRef = useRef<WebSocket | null>(null);
  const desktopControlEnabledRef = useRef(false);
  const calibrationActiveRef = useRef(false);
  const videoViewportRef = useRef<HTMLDivElement | null>(null);
  const statsPreviousRef = useRef(new Map<string, { bytes: number; at: number; jitterDelay: number; jitterMinimumDelay: number | null; jitterTargetDelay: number | null; jitterCount: number; decodeTime: number | null; decodedFrames: number; lost: number }>());
  const videoDelayRef = useRef<number | null>(null);
  const pointerAtRef = useRef(0);
  const rtcConfigRef = useRef<RTCConfiguration>(defaultRtcConfig());
  const turnEnabledRef = useRef(false);
  const selfPeerIdRef = useRef("");
  const controlRef = useRef<ControlState | null>(null);
  const browserTargetReadyRef = useRef(false);
  const companionAttemptRef = useRef(0);
  const companionConnectedOnceRef = useRef(false);
  const pressedVirtualKeysRef = useRef(new Map<string, VirtualKey>());

  useEffect(() => {
    let restoreTimer: number | undefined;
    try {
      const saved = JSON.parse(window.localStorage.getItem(customVirtualKeysStorageKey) || "[]");
      if (Array.isArray(saved)) {
        const available = new Set(customVirtualKeyOptions.map(({ button }) => button));
        const keys = saved.filter((button): button is string => typeof button === "string" && available.has(button)).slice(0, 12);
        restoreTimer = window.setTimeout(() => setCustomVirtualKeys(keys), 0);
      }
    } catch {
      window.localStorage.removeItem(customVirtualKeysStorageKey);
    }
    return () => {
      if (restoreTimer !== undefined) window.clearTimeout(restoreTimer);
    };
  }, []);

  useEffect(() => { roleRef.current = role; }, [role]);
  useEffect(() => { selfPeerIdRef.current = selfPeerId; }, [selfPeerId]);
  useEffect(() => {
    controlRef.current = control;
    if (roleRef.current === "host" && companionRef.current?.readyState === WebSocket.OPEN) {
      companionRef.current.send(JSON.stringify({ type: "set-turn", remote: Boolean(control && control.ownerPeerId !== selfPeerIdRef.current) }));
    }
  }, [control]);
  useEffect(() => {
    if (role === "host" && localVideoRef.current && streamRef.current) localVideoRef.current.srcObject = streamRef.current;
  }, [role]);

  const sendSignal = useCallback((message: object) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) wsRef.current.send(JSON.stringify(message));
  }, []);

  const forwardToCompanion = useCallback((event: RemoteEvent) => {
    if ((desktopControlEnabledRef.current || calibrationActiveRef.current) && companionRef.current?.readyState === WebSocket.OPEN) {
      companionRef.current.send(JSON.stringify(event));
    }
  }, []);

  const receiveCommand = useCallback((message: MessageEvent<string>) => {
    const event = JSON.parse(message.data) as RemoteEvent;
    forwardToCompanion(event);
    if (event.type === "pointer") {
      setRemotePointer((old) => ({ ...old, x: event.x ?? 0.5, y: event.y ?? 0.5, visible: true }));
    } else if (event.type === "click" || event.type === "pointer-down") {
      setRemotePointer({ x: event.x ?? 0.5, y: event.y ?? 0.5, visible: true, click: true });
      setLastCommand(`点击 ${Math.round((event.x ?? 0) * 100)}% × ${Math.round((event.y ?? 0) * 100)}%`);
      window.setTimeout(() => setRemotePointer((old) => ({ ...old, click: false })), 260);
    } else if (event.type === "key" || event.type === "key-down") {
      setLastCommand(`按下 ${event.key}`);
    } else if (event.type === "text") {
      setLastCommand(`输入 ${event.text}`);
    }
  }, [forwardToCompanion]);

  const bindChannel = useCallback((peerId: string, channel: RTCDataChannel) => {
    channelsRef.current.set(peerId, channel);
    channel.onmessage = (event) => {
      if (roleRef.current === "host" && peersRef.current.find((peer) => peer.peerId === peerId)?.role !== "controller") return;
      const state = controlRef.current;
      const allowed = state?.phase === "calibration"
        ? state.ownerPeerId === peerId
        : state?.mode === "free"
          ? state.phase === "playing"
          : state?.phase === "playing" && state.ownerPeerId === peerId;
      if (roleRef.current === "host" && !allowed) return;
      receiveCommand(event);
    };
    channel.onclose = () => channelsRef.current.delete(peerId);
  }, [receiveCommand]);

  const bindPeer = useCallback((peerId: string, pc: RTCPeerConnection) => {
    pcsRef.current.set(peerId, pc);
    pc.onicecandidate = (event) => {
      if (event.candidate) sendSignal({ type: "signal", target: peerId, data: { candidate: event.candidate.toJSON() } });
    };
    pc.ontrack = (event) => {
      preferLowLatencyPlayback(event.receiver);
      if (remoteVideoRef.current) remoteVideoRef.current.srcObject = event.streams[0];
    };
    pc.onconnectionstatechange = () => {
      const active = [...pcsRef.current.values()].filter((item) => item.connectionState === "connected").length;
      setConnectedPeers(active);
      if (pc.connectionState === "connected" && roleRef.current === "guest") {
        setStatus("画面与控制连接已重新载入");
        setNotice("");
      }
      if (pc.connectionState === "failed") setNotice(turnEnabledRef.current ? "连接失败；TURN 已配置，请检查凭据状态或网络是否阻止 UDP/TCP/TLS。" : "点对点连接失败；当前仅有 STUN，公网连接需要配置 TURN 服务。");
    };
  }, [sendSignal]);

  const createHostPeer = useCallback(async (peerId: string) => {
    if (pcsRef.current.has(peerId) || !streamRef.current) return;
    const pc = new RTCPeerConnection(rtcConfigRef.current);
    bindPeer(peerId, pc);
    const senders = streamRef.current.getTracks().map((track) => pc.addTrack(track, streamRef.current!));
    await Promise.all(senders.filter((sender) => sender.track?.kind === "video").map((sender) => preferSmoothVideo(sender, videoProfiles[videoProfile])));
    // Keyboard and mouse button transitions must arrive in order. Losing a key-up
    // leaves games thinking the key is held and makes later presses appear inert.
    const channel = pc.createDataChannel("controls", { ordered: true });
    bindChannel(peerId, channel);
    await pc.setLocalDescription(await pc.createOffer());
    sendSignal({ type: "signal", target: peerId, data: { description: pc.localDescription } });
  }, [bindChannel, bindPeer, sendSignal, videoProfile]);

  const ensureGuestPeer = useCallback((hostId: string) => {
    const existing = pcsRef.current.get(hostId);
    if (existing) return existing;
    const pc = new RTCPeerConnection(rtcConfigRef.current);
    bindPeer(hostId, pc);
    pc.ondatachannel = (event) => bindChannel(hostId, event.channel);
    return pc;
  }, [bindChannel, bindPeer]);

  const applySignal = useCallback(async (from: string, data: { description?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit }) => {
    const pc = roleRef.current === "host" ? pcsRef.current.get(from) : ensureGuestPeer(from);
    if (!pc) return;
    if (data.description) {
      await pc.setRemoteDescription(data.description);
      for (const candidate of candidateQueueRef.current.get(from) ?? []) await pc.addIceCandidate(candidate);
      candidateQueueRef.current.delete(from);
      if (data.description.type === "offer") {
        await pc.setLocalDescription(await pc.createAnswer());
        sendSignal({ type: "signal", target: from, data: { description: pc.localDescription } });
      }
    } else if (data.candidate) {
      if (pc.remoteDescription) await pc.addIceCandidate(data.candidate);
      else candidateQueueRef.current.set(from, [...(candidateQueueRef.current.get(from) ?? []), data.candidate]);
    }
  }, [ensureGuestPeer, sendSignal]);

  const stopRtc = useCallback(() => {
    for (const pc of pcsRef.current.values()) pc.close();
    pcsRef.current.clear();
    channelsRef.current.clear();
    candidateQueueRef.current.clear();
    statsPreviousRef.current.clear();
    videoDelayRef.current = null;
    setConnectedPeers(0);
    setRemotePointer((old) => ({ ...old, visible: false, click: false }));
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
  }, []);

  const connectSignaling = useCallback(() => new Promise<WebSocket>((resolve, reject) => {
    const socket = new WebSocket(signalUrl());
    let iceReady = false;
    const timeout = window.setTimeout(() => { socket.close(); reject(new Error("timeout")); }, 9000);
    socket.onopen = () => socket.send(JSON.stringify({ type: "get-ice-servers" }));
    socket.onerror = () => { window.clearTimeout(timeout); reject(new Error("connection")); };
    socket.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.type === "ice-servers") {
        const configuration = message as IceServerMessage;
        const builtInTurn = rtcConfigRef.current.iceServers?.some((server) => (Array.isArray(server.urls) ? server.urls : [server.urls]).some((url) => url.startsWith("turn"))) ?? false;
        if (configuration.turnEnabled || !builtInTurn) rtcConfigRef.current = { iceServers: configuration.iceServers };
        turnEnabledRef.current = configuration.turnEnabled || builtInTurn;
        setTurnStatus(turnEnabledRef.current ? "TURN 已就绪" : "仅 STUN");
        if (configuration.error) setNotice(configuration.error);
        if (!iceReady) { iceReady = true; window.clearTimeout(timeout); wsRef.current = socket; resolve(socket); }
        return;
      }
      if (message.type === "room-created") { selfPeerIdRef.current = message.peerId; setSelfPeerId(message.peerId); setRoomCode(message.roomCode); setStatus("房间已创建，等待访客"); }
      if (message.type === "join-pending") { selfPeerIdRef.current = message.peerId; setSelfPeerId(message.peerId); setRoomCode(message.roomCode); setStatus("等待房主批准"); }
      if (message.type === "join-approved") { setPeerRole(message.role); setStatus(message.role === "controller" ? "已获操作权限，正在连接" : "已进入观战模式，正在连接"); }
      if (message.type === "join-rejected") { setNotice(message.reason); setStatus("加入被拒绝"); }
      if (message.type === "room-state") {
        peersRef.current = message.peers;
        controlRef.current = message.control;
        setPeers(message.peers);
        setControl(message.control);
      }
      if (message.type === "begin-calibration") {
        if (companionRef.current?.readyState === WebSocket.OPEN && browserTargetReadyRef.current) {
          companionRef.current.send(JSON.stringify({ type: "start-calibration" }));
        } else {
          sendSignal({ type: "cancel-calibration", peerId: message.peerId, reason: "房主尚未连接助手并选定目标页面" });
        }
      }
      if (message.type === "abort-calibration") {
        calibrationActiveRef.current = false;
        setCalibrationState("off");
        companionRef.current?.send(JSON.stringify({ type: "cancel-calibration" }));
      }
      if (message.type === "reset-page-control") {
        desktopControlEnabledRef.current = false;
        calibrationActiveRef.current = false;
        setDesktopControlEnabled(false);
        setCalibrationState("off");
        companionRef.current?.send(JSON.stringify({ type: "cancel-calibration" }));
        companionRef.current?.send(JSON.stringify({ type: "set-control", enabled: false }));
      }
      if (message.type === "reload-session" && roleRef.current === "guest") {
        stopRtc();
        setStatus("控制环境已更新，正在重新连接画面");
        setNotice(message.reason || "控制环境已更新，正在重新载入连接。");
        sendSignal({ type: "reload-session-ready" });
      }
      if (message.type === "restart-peer" && roleRef.current === "host") {
        pcsRef.current.get(message.peerId)?.close();
        pcsRef.current.delete(message.peerId);
        channelsRef.current.get(message.peerId)?.close();
        channelsRef.current.delete(message.peerId);
        candidateQueueRef.current.delete(message.peerId);
        void createHostPeer(message.peerId);
      }
      if (message.type === "peer-ready") void createHostPeer(message.peer.peerId);
      if (message.type === "peer-left") {
        pcsRef.current.get(message.peerId)?.close(); pcsRef.current.delete(message.peerId); channelsRef.current.delete(message.peerId);
      }
      if (message.type === "role-changed") { setPeerRole(message.role); setStatus(message.role === "controller" ? "房主已授予操作权限" : "房主已切换为只读观战"); }
      if (message.type === "signal") void applySignal(message.from, message.data);
      if (message.type === "room-closed") {
        stopRtc();
        setPeerRole("spectator");
        controlRef.current = null;
        setControl(null);
        setNotice(message.reason);
        setStatus("房间已关闭，媒体与控制连接已停止");
      }
      if (message.type === "error") { setNotice(message.message); setStatus("本地服务返回错误"); }
    };
    socket.onclose = () => {
      if (!roleRef.current) return;
      stopRtc();
      companionRef.current?.send(JSON.stringify({ type: "set-turn", remote: false }));
      controlRef.current = null;
      setControl(null);
      setStatus("信令服务已断开，媒体与控制连接已停止");
      setNotice("信令连接中断。为避免失控，本局已在本机停止；请重新创建或加入房间。");
    };
  }), [applySignal, createHostPeer, sendSignal, stopRtc]);

  const createRoom = async () => {
    setNotice("");
    try {
      const stream = await selectDisplayStream(shareAudio, videoProfiles[videoProfile]);
      const videoTrack = stream.getVideoTracks()[0];
      streamRef.current = stream;
      videoTrack.onended = () => setStatus("屏幕分享已停止");
      setRole("host"); roleRef.current = "host";
      setStatus("正在连接本地信令服务");
      const socket = await connectSignaling();
      socket.send(JSON.stringify({ type: "create-room", name: name.trim() || "房主", mode: "free" }));
    } catch (error) {
      streamRef.current?.getTracks().forEach((track) => track.stop()); streamRef.current = null;
      setRole(null); roleRef.current = null;
      setNotice(error instanceof DOMException && error.name === "NotAllowedError" ? "你取消了屏幕分享。" : "无法连接本地信令服务，请先运行 npm run dev。");
    }
  };

  const changeSharedWindow = async () => {
    if (roleRef.current !== "host" || isChangingShare) return;
    setIsChangingShare(true);
    setNotice("");
    let nextStream: MediaStream | null = null;
    const replacements: Array<{ sender: RTCRtpSender; previous: MediaStreamTrack | null }> = [];
    try {
      nextStream = await selectDisplayStream(shareAudio, videoProfiles[videoProfile]);
      const previousStream = streamRef.current;
      if (!previousStream) throw new Error("当前没有可替换的共享画面");
      const nextVideoTrack = nextStream.getVideoTracks()[0];
      let nextAudioTrack = nextStream.getAudioTracks()[0] ?? null;
      if (pcsRef.current.size > 0 && previousStream.getAudioTracks().length === 0 && nextAudioTrack) {
        nextStream.removeTrack(nextAudioTrack);
        nextAudioTrack.stop();
        nextAudioTrack = null;
      }

      for (const pc of pcsRef.current.values()) {
        const videoSender = pc.getSenders().find((sender) => sender.track?.kind === "video");
        if (!videoSender) throw new Error("当前连接缺少可替换的视频发送轨道");
        replacements.push({ sender: videoSender, previous: videoSender.track });
        await videoSender.replaceTrack(nextVideoTrack);
        await preferSmoothVideo(videoSender, videoProfiles[videoProfile]);

        const audioSender = pc.getTransceivers()
          .find((transceiver) => transceiver.sender.track?.kind === "audio" || transceiver.receiver.track.kind === "audio")
          ?.sender;
        if (audioSender) {
          replacements.push({ sender: audioSender, previous: audioSender.track });
          await audioSender.replaceTrack(nextAudioTrack);
        }
      }

      streamRef.current = nextStream;
      nextVideoTrack.onended = () => setStatus("屏幕分享已停止，可点击“更换共享窗口”继续当前房间");
      if (localVideoRef.current) localVideoRef.current.srcObject = nextStream;
      previousStream.getTracks().forEach((track) => {
        track.onended = null;
        track.stop();
      });

      browserTargetReadyRef.current = false;
      desktopControlEnabledRef.current = false;
      calibrationActiveRef.current = false;
      setDesktopControlEnabled(false);
      setBrowserTargetId("");
      setBrowserTargetReady(false);
      setBrowserViewport(null);
      setCalibrationState("off");
      companionRef.current?.send(JSON.stringify({ type: "cancel-calibration" }));
      companionRef.current?.send(JSON.stringify({ type: "set-control", enabled: false }));
      companionRef.current?.send(JSON.stringify({ type: "set-turn", remote: false }));
      companionRef.current?.send(JSON.stringify({ type: "refresh-targets" }));
      sendSignal({ type: "reset-control-for-share" });
      setLastCommand("共享窗口已更换，请重新选择控制目标并校准");
      setStatus("共享窗口已更换，房间与访客连接保持不变");
    } catch (error) {
      await Promise.allSettled(replacements.reverse().map(({ sender, previous }) => sender.replaceTrack(previous)));
      nextStream?.getTracks().forEach((track) => track.stop());
      const cancelled = error instanceof DOMException && error.name === "NotAllowedError";
      setNotice(cancelled ? "已取消更换共享窗口，当前共享保持不变。" : "更换共享窗口失败：" + (error instanceof Error ? error.message : "未知错误"));
    } finally {
      setIsChangingShare(false);
    }
  };

  const joinRoom = async () => {
    if (joinCode.trim().length !== 6) return setNotice("请输入 6 位房间码。");
    setNotice(""); setRole("guest"); roleRef.current = "guest"; setStatus("正在连接本地信令服务");
    try {
      const socket = await connectSignaling();
      socket.send(JSON.stringify({ type: "join-room", roomCode: joinCode, name: name.trim() || "访客", role: requestedRole }));
    } catch { setRole(null); roleRef.current = null; setNotice("无法连接本地信令服务，请先运行 npm run dev。"); }
  };

  const approve = (peerId: string, approvedRole: PeerRole) => sendSignal({ type: "approve-peer", peerId, role: approvedRole });
  const setRemoteRole = (peerId: string, nextRole: PeerRole) => sendSignal({ type: "set-role", peerId, role: nextRole });

  const sendControl = (event: RemoteEvent) => {
    const state = controlRef.current;
    const allowed = state?.phase === "calibration"
      ? state.ownerPeerId === selfPeerIdRef.current
      : state?.phase === "playing";
    if (peerRole !== "controller" || !allowed) return;
    for (const channel of channelsRef.current.values()) if (channel.readyState === "open") channel.send(JSON.stringify(event));
  };

  const pointerEvent = (event: React.PointerEvent<HTMLDivElement>, type: "pointer" | "pointer-down" | "pointer-up") => {
    if (type === "pointer" && performance.now() - pointerAtRef.current < 32) return;
    pointerAtRef.current = performance.now();
    const rect = event.currentTarget.getBoundingClientRect();
    const video = remoteVideoRef.current;
    const sourceAspect = video?.videoWidth && video.videoHeight ? video.videoWidth / video.videoHeight : videoAspect;
    const boxAspect = rect.width / rect.height;
    const contentWidth = boxAspect > sourceAspect ? rect.height * sourceAspect : rect.width;
    const contentHeight = boxAspect > sourceAspect ? rect.height : rect.width / sourceAspect;
    const contentLeft = rect.left + (rect.width - contentWidth) / 2;
    const contentTop = rect.top + (rect.height - contentHeight) / 2;
    const x = (event.clientX - contentLeft) / contentWidth;
    const y = (event.clientY - contentTop) / contentHeight;
    const outside = x < 0 || x > 1 || y < 0 || y > 1;
    if (outside && (type === "pointer-down" || (type === "pointer" && event.buttons === 0))) return;
    sendControl({
      type,
      x: Math.max(0, Math.min(1, x)),
      y: Math.max(0, Math.min(1, y)),
      button: event.button,
      buttons: event.buttons,
    });
  };

  const sendCaptureInfo = (video?: HTMLVideoElement | null) => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track || companionRef.current?.readyState !== WebSocket.OPEN) return;
    const settings = track.getSettings() as MediaTrackSettings & { displaySurface?: string };
    companionRef.current.send(JSON.stringify({
      type: "set-capture-info",
      surface: settings.displaySurface === "monitor" ? "monitor" : "window",
      width: video?.videoWidth || settings.width || 0,
      height: video?.videoHeight || settings.height || 0,
    }));
  };

  const syncVideoAspect = (video: HTMLVideoElement) => {
    if (video.videoWidth > 0 && video.videoHeight > 0) {
      setVideoAspect(video.videoWidth / video.videoHeight);
      if (roleRef.current === "host") sendCaptureInfo(video);
    }
  };

  const connectCompanion = () => {
    const attempt = ++companionAttemptRef.current;
    const previous = companionRef.current;
    if (previous) {
      previous.onopen = null;
      previous.onmessage = null;
      previous.onerror = null;
      previous.onclose = null;
      previous.close();
    }
    browserTargetReadyRef.current = false;
    sendSignal({ type: "set-calibration-ready", ready: false });
    desktopControlEnabledRef.current = false;
    calibrationActiveRef.current = false;
    setDesktopControlEnabled(false);
    setBrowserTargets([]);
    setBrowserTargetId("");
    setBrowserTargetReady(false);
    setBrowserViewport(null);
    setCalibrationState("off");
    setCompanionState("connecting"); setNotice("");
    const socket = new WebSocket("ws://127.0.0.1:8765");
    companionRef.current = socket;
    socket.onopen = () => {
      if (companionAttemptRef.current !== attempt) return socket.close();
      socket.send(JSON.stringify({ type: "auth", code: companionCode.trim(), protocols: ["mutiny-input-v6", "cdp-page-v5"] }));
    };
    socket.onmessage = (event) => {
      if (companionAttemptRef.current !== attempt) return;
      const message = JSON.parse(event.data);
      if (message.type === "auth-ok") {
        if (message.protocol !== "mutiny-input-v6") {
          socket.close();
          setCompanionState("off");
          setNotice("检测到旧版助手仍在运行。请在旧终端按 Ctrl+C，再重新运行 npm run companion:arm。");
          return;
        }
        desktopControlEnabledRef.current = false;
        setDesktopControlEnabled(false);
        setCompanionState("ready");
        setLastCommand("应用控制助手已连接，请选择控制目标");
        if (companionConnectedOnceRef.current) {
          sendSignal({ type: "reset-control-session", reason: "房主页面助手已重新连接，上一轮控制状态已清除" });
        }
        companionConnectedOnceRef.current = true;
        sendCaptureInfo(localVideoRef.current);
        socket.send(JSON.stringify({ type: "set-turn", remote: Boolean(controlRef.current && controlRef.current.ownerPeerId !== selfPeerIdRef.current) }));
      }
      if (message.type === "targets") {
        setBrowserTargets(message.targets);
        setBrowserTargetId((current) => {
          if (message.targets.some((target: ControlTarget) => target.id === current)) return current;
          browserTargetReadyRef.current = false;
          sendSignal({ type: "set-calibration-ready", ready: false });
          setBrowserTargetReady(false);
          setBrowserViewport(null);
          calibrationActiveRef.current = false;
          setCalibrationState("off");
          return "";
        });
      }
      if (message.type === "target-selected") {
        browserTargetReadyRef.current = true;
        setBrowserTargetId(message.target.id);
        setBrowserTargetReady(true);
        setBrowserViewport(message.viewport);
        calibrationActiveRef.current = false;
        setCalibrationState("off");
        setLastCommand(`已锁定${message.target.kind === "window" ? "应用窗口" : "浏览器页面"}：${message.target.title || message.target.url}`);
        sendSignal({ type: "set-calibration-ready", ready: true });
        sendCaptureInfo(localVideoRef.current);
        socket.send(JSON.stringify({ type: "set-turn", remote: Boolean(controlRef.current && controlRef.current.ownerPeerId !== selfPeerIdRef.current) }));
      }
      if (message.type === "target-closed") {
        browserTargetReadyRef.current = false;
        sendSignal({ type: "set-calibration-ready", ready: false });
        desktopControlEnabledRef.current = false;
        setDesktopControlEnabled(false);
        setBrowserTargetReady(false);
        setBrowserViewport(null);
        calibrationActiveRef.current = false;
        setCalibrationState("off");
        setNotice("控制目标已关闭，请重新选择。");
      }
      if (message.type === "control-state") {
        desktopControlEnabledRef.current = message.enabled;
        setDesktopControlEnabled(message.enabled);
        setLastCommand(message.enabled ? "指定目标的远程控制已开启" : "已切回仅预览指针");
        if (message.enabled && controlRef.current?.phase === "ready") sendSignal({ type: "start-game" });
      }
      if (message.type === "calibration-state") {
        const active = message.state === "point-1" || message.state === "point-2";
        calibrationActiveRef.current = active;
        setCalibrationState(message.state);
        if (message.message) setNotice(message.message);
        if (active) sendSignal({ type: "calibration-progress", state: message.state, message: message.message || null });
        setLastCommand(message.state === "point-1" ? "请让远端点击画面中的定位点 1 / 2" : message.state === "point-2" ? "请让远端点击画面中的定位点 2 / 2" : message.state === "complete" ? "坐标校准完成，可以启用页面控制" : "坐标校准已停止");
        if (message.state === "complete") sendSignal({ type: "finish-calibration" });
      }
      if (message.type === "cdp-error" || message.type === "native-error" || message.type === "input-error") {
        setNotice(message.message);
        if (message.type === "input-error" && message.operation === "start-calibration") {
          calibrationActiveRef.current = false;
          setCalibrationState("off");
          sendSignal({ type: "cancel-calibration", reason: message.message });
        }
      }
      if (message.type === "auth-error") { setCompanionState("off"); setNotice("应用控制助手授权码不正确，可以修改后重新连接。"); socket.close(); }
    };
    socket.onerror = () => {
      if (companionAttemptRef.current !== attempt) return;
      setCompanionState("off");
      setNotice("无法连接应用控制助手，请先运行 npm run companion:arm，然后重试。");
    };
    socket.onclose = () => {
      if (companionAttemptRef.current !== attempt) return;
      companionRef.current = null;
      browserTargetReadyRef.current = false;
      sendSignal({ type: "set-calibration-ready", ready: false });
      desktopControlEnabledRef.current = false;
      setDesktopControlEnabled(false);
      setCompanionState("off");
      setBrowserTargetReady(false);
      setBrowserViewport(null);
      calibrationActiveRef.current = false;
      setCalibrationState("off");
    };
  };

  const selectBrowserTarget = (targetId: string) => {
    browserTargetReadyRef.current = false;
    sendSignal({ type: "set-calibration-ready", ready: false });
    desktopControlEnabledRef.current = false;
    setDesktopControlEnabled(false);
    setBrowserTargetId(targetId);
    setBrowserTargetReady(false);
    setBrowserViewport(null);
    calibrationActiveRef.current = false;
    setCalibrationState("off");
    if (targetId && companionRef.current?.readyState === WebSocket.OPEN) {
      companionRef.current.send(JSON.stringify({ type: "select-target", targetId }));
    }
  };

  const toggleDesktopControl = () => {
    const enabled = !desktopControlEnabledRef.current;
    companionRef.current?.send(JSON.stringify({ type: "set-control", enabled }));
  };

  const startHostCalibration = (peerId: string) => {
    setNotice("");
    sendSignal({ type: "start-calibration", peerId });
  };

  const restartHostCalibration = () => {
    setNotice("");
    sendSignal({ type: "restart-calibration" });
  };

  const cancelHostCalibration = () => sendSignal({ type: "cancel-calibration" });

  const pressVirtualKey = (button: string) => {
    if (!canGuestControl) return;
    if (button === "{shift}") {
      setKeyboardLayoutName((current) => current === "default" ? "shift" : "default");
      return;
    }
    if (pressedVirtualKeysRef.current.has(button)) return;
    const entry = virtualKey(button);
    if (!entry) return;
    pressedVirtualKeysRef.current.set(button, entry);
    if (entry.shiftKey) sendControl({ type: "key-down", key: "Shift", code: "ShiftLeft", keyCode: 16, location: 1, shiftKey: true });
    sendControl({ type: "key-down", ...entry });
  };

  const releaseVirtualKey = (button: string) => {
    const entry = pressedVirtualKeysRef.current.get(button);
    if (!entry) return;
    pressedVirtualKeysRef.current.delete(button);
    sendControl({ type: "key-up", ...entry });
    if (entry.shiftKey) {
      sendControl({ type: "key-up", key: "Shift", code: "ShiftLeft", keyCode: 16, location: 1 });
      setKeyboardLayoutName("default");
    }
  };

  const pressVirtualButton = (event: ReactPointerEvent<HTMLButtonElement>, button: string) => {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    pressVirtualKey(button);
  };

  const releaseVirtualButton = (event: ReactPointerEvent<HTMLButtonElement>, button: string) => {
    event.preventDefault();
    event.stopPropagation();
    releaseVirtualKey(button);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const toggleCustomVirtualKey = (button: string) => {
    setCustomVirtualKeys((current) => {
      const selected = current.includes(button);
      const next = selected ? current.filter((entry) => entry !== button) : current.length < 12 ? [...current, button] : current;
      window.localStorage.setItem(customVirtualKeysStorageKey, JSON.stringify(next));
      return next;
    });
  };

  const toggleVideoFullscreen = async () => {
    const viewport = videoViewportRef.current;
    if (!viewport) return;
    try {
      if (document.fullscreenElement === viewport) {
        await document.exitFullscreen();
      } else {
        await viewport.requestFullscreen();
      }
    } catch {
      setNotice("当前浏览器不支持页面控制层全屏，请保持横屏使用悬浮按键。");
    }
  };

  const sendRemoteText = (text: string) => {
    if (text) sendControl({ type: "text", text });
  };

  const reset = useCallback(() => {
    companionAttemptRef.current += 1;
    companionConnectedOnceRef.current = false;
    browserTargetReadyRef.current = false;
    companionRef.current?.send(JSON.stringify({ type: "set-turn", remote: false }));
    wsRef.current?.close(); companionRef.current?.close();
    for (const pc of pcsRef.current.values()) pc.close();
    streamRef.current?.getTracks().forEach((track) => track.stop());
    wsRef.current = null; companionRef.current = null; streamRef.current = null;
    pcsRef.current.clear(); channelsRef.current.clear(); candidateQueueRef.current.clear();
    statsPreviousRef.current.clear();
    videoDelayRef.current = null;
    peersRef.current = []; selfPeerIdRef.current = ""; controlRef.current = null; desktopControlEnabledRef.current = false; calibrationActiveRef.current = false; turnEnabledRef.current = false; rtcConfigRef.current = defaultRtcConfig(); pressedVirtualKeysRef.current.clear(); setKeyboardLayoutName("default"); setDesktopControlEnabled(false); setBrowserTargets([]); setBrowserTargetId(""); setBrowserTargetReady(false); setBrowserViewport(null); setCalibrationState("off"); setZoom(1); setRole(null); roleRef.current = null; setRoomCode(""); setSelfPeerId(""); setControl(null); setPeers([]); setConnectedPeers(0); setTurnStatus("正在检查 ICE"); setMediaPath("等待连接"); setStatus("本地服务未连接"); setNotice(""); setCompanionState("off");
  }, []);

  const closeHostedRoom = () => {
    companionRef.current?.send(JSON.stringify({ type: "set-turn", remote: false }));
    sendSignal({ type: "close-room" });
    window.setTimeout(reset, 80);
  };

  useEffect(() => () => reset(), [reset]);

  useEffect(() => {
    if (!role || !selfPeerId || control?.ownerPeerId !== selfPeerId) return;
    sendSignal({ type: "control-heartbeat" });
    const timer = window.setInterval(() => sendSignal({ type: "control-heartbeat" }), 25_000);
    return () => window.clearInterval(timer);
  }, [control?.ownerPeerId, role, selfPeerId, sendSignal]);

  useEffect(() => {
    if (role !== "guest") {
      videoDelayRef.current = null;
      return;
    }
    const video = remoteVideoRef.current;
    if (!video || typeof video.requestVideoFrameCallback !== "function") return;
    let active = true;
    let callbackId = 0;
    const measureFrameDelay = (now: number, metadata: VideoFrameCallbackMetadata) => {
      const webRtcMetadata = metadata as WebRtcVideoFrameMetadata;
      if (typeof webRtcMetadata.captureTime === "number") {
        const sample = Math.round((metadata.expectedDisplayTime || now) - webRtcMetadata.captureTime);
        if (Number.isFinite(sample) && sample >= 0 && sample < 10_000) {
          const previous = videoDelayRef.current;
          videoDelayRef.current = previous == null ? sample : Math.round(previous * 0.8 + sample * 0.2);
        }
      }
      if (active) callbackId = video.requestVideoFrameCallback(measureFrameDelay);
    };
    callbackId = video.requestVideoFrameCallback(measureFrameDelay);
    return () => {
      active = false;
      video.cancelVideoFrameCallback(callbackId);
      videoDelayRef.current = null;
    };
  }, [role]);

  useEffect(() => {
    if (!role) return;
    const timer = window.setInterval(async () => {
      const entry = [...pcsRef.current.entries()][0];
      if (!entry) return setQuality({ rtt: null, videoDelay: null, jitterBuffer: null, jitterBufferMinimum: null, jitterBufferTarget: null, decodeTime: null, bitrate: 0, fps: null, lost: 0 });
      const [peerId, pc] = entry;
      const reports = await pc.getStats();
      let bytes = 0, fps: number | null = null, lost = 0, rtt: number | null = null;
      let jitterDelay = 0, jitterCount = 0, decodedFrames = 0;
      let jitterMinimumDelay: number | null = null, jitterTargetDelay: number | null = null, decodeTime: number | null = null;
      let selectedPair;
      reports.forEach((report) => {
        if ((report.type === "inbound-rtp" || report.type === "outbound-rtp") && report.kind === "video") {
          bytes += report.bytesReceived ?? report.bytesSent ?? 0; fps = report.framesPerSecond ?? fps; lost += report.packetsLost ?? 0;
          if (report.type === "inbound-rtp") {
            jitterDelay += report.jitterBufferDelay ?? 0; jitterCount += report.jitterBufferEmittedCount ?? 0;
            if (typeof report.jitterBufferMinimumDelay === "number") jitterMinimumDelay = (jitterMinimumDelay ?? 0) + report.jitterBufferMinimumDelay;
            if (typeof report.jitterBufferTargetDelay === "number") jitterTargetDelay = (jitterTargetDelay ?? 0) + report.jitterBufferTargetDelay;
            if (typeof report.totalDecodeTime === "number") decodeTime = (decodeTime ?? 0) + report.totalDecodeTime; decodedFrames += report.framesDecoded ?? 0;
          }
        }
        if (report.type === "candidate-pair" && report.state === "succeeded" && (report.nominated || report.selected)) {
          selectedPair = report;
          if (report.currentRoundTripTime != null) rtt = Math.round(report.currentRoundTripTime * 1000);
        }
      });
      if (selectedPair) {
        const local = reports.get(selectedPair.localCandidateId);
        const remote = reports.get(selectedPair.remoteCandidateId);
        setMediaPath(local?.candidateType === "relay" || remote?.candidateType === "relay" ? "TURN 中继" : "P2P 直连");
      }
      const now = performance.now(); const previous = statsPreviousRef.current.get(peerId);
      const bitrate = previous ? Math.max(0, Math.round(((bytes - previous.bytes) * 8) / ((now - previous.at) / 1000) / 1000)) : 0;
      const emitted = previous ? jitterCount - previous.jitterCount : 0;
      const recentLost = previous ? Math.max(0, lost - previous.lost) : 0;
      const jitterBuffer = previous && emitted > 0 ? Math.max(0, Math.round(((jitterDelay - previous.jitterDelay) / emitted) * 1000)) : null;
      const jitterBufferMinimum = previous && emitted > 0 && jitterMinimumDelay != null && previous.jitterMinimumDelay != null ? Math.max(0, Math.round(((jitterMinimumDelay - previous.jitterMinimumDelay) / emitted) * 1000)) : null;
      const jitterBufferTarget = previous && emitted > 0 && jitterTargetDelay != null && previous.jitterTargetDelay != null ? Math.max(0, Math.round(((jitterTargetDelay - previous.jitterTargetDelay) / emitted) * 1000)) : null;
      const frames = previous ? decodedFrames - previous.decodedFrames : 0;
      const averageDecodeTime = previous && frames > 0 && decodeTime != null && previous.decodeTime != null ? Math.max(0, Math.round(((decodeTime - previous.decodeTime) / frames) * 1000)) : null;
      statsPreviousRef.current.set(peerId, { bytes, at: now, jitterDelay, jitterMinimumDelay, jitterTargetDelay, jitterCount, decodeTime, decodedFrames, lost });
      setQuality({ rtt, videoDelay: role === "guest" ? videoDelayRef.current : null, jitterBuffer, jitterBufferMinimum, jitterBufferTarget, decodeTime: averageDecodeTime, bitrate, fps, lost: recentLost });
    }, 2000);
    return () => window.clearInterval(timer);
  }, [role]);

  const connected = connectedPeers > 0;
  const pendingPeers = peers.filter((peer) => !peer.approved);
  const approvedPeers = peers.filter((peer) => peer.approved);
  const hasControl = Boolean(selfPeerId && control?.ownerPeerId === selfPeerId);
  const canGuestControl = role === "guest" && peerRole === "controller" && Boolean(control && (
    control.phase === "calibration"
      ? hasControl
      : control.phase === "playing"
  ));
  const selectedTarget = browserTargets.find((target) => target.id === browserTargetId);
  const nativeTarget = selectedTarget?.kind === "window";
  const controlLabel = control?.phase === "calibration" ? "校准阶段" : control?.phase === "ready" ? "校准完成" : control?.phase === "playing" ? "远程控制" : "准备阶段";
  const controlTitle = control?.phase === "setup" ? "等待房主发起校准" : control?.phase === "calibration" ? `房主正在校准 · ${control.ownerName}` : control?.phase === "ready" ? "等待启用远程控制" : "远程控制已启用";
  const controlDescription = control?.phase === "setup" ? role === "host" ? "批准操作者、连接应用控制助手并选定目标；随后由房主在成员列表中发起校准。" : "等待房主选定控制目标并发起校准。" : control?.phase === "calibration" ? role === "host" ? "目标窗口已自动置前；房主可以重新开始或取消本次校准。" : hasControl ? "房主已发起校准；Chromium 目标请依次点击两个定位点，Windows 应用会自动完成映射。" : "房主正在为其他操作者校准，本地输入暂不可用。" : control?.phase === "ready" ? role === "host" ? "点击“启用远程控制”会再次置前目标窗口，并开放远程输入。" : "校准已完成，等待房主启用远程控制。" : "获准的远端操作者可以持续使用鼠标和键盘。";

  return <main className="shell">
    <nav className="topbar">
      <div className="brand"><span className="brandMark">M</span><span>Mutiny Relay</span></div>
      <a className="prototypeTag" href="/">← 返回首页</a>
    </nav>

    {!role && <>
      <section className="hero compactHero">
        <div className="eyebrow">SHORT CODE · HOST APPROVAL · LIVE STATS</div>
        <h1>通用同屏，<br />自由协作</h1>
        <p>获准操作者可以控制选定的浏览器页面、Windows 应用窗口或共享屏幕。</p>
        <input className="nameInput" value={name} onChange={(event) => setName(event.target.value)} placeholder="你的昵称（可选）" maxLength={24} />
        <div className="streamProfileOption">
          <label htmlFor="video-profile"><strong>视频传输档位</strong><small>{videoProfiles[videoProfile].detail}；码率为上限，网络拥塞时仍会自动降低</small></label>
          <select id="video-profile" value={videoProfile} onChange={(event) => setVideoProfile(event.target.value as VideoProfileKey)}>
            {(Object.entries(videoProfiles) as Array<[VideoProfileKey, VideoProfile]>).map(([key, profile]) => <option key={key} value={key}>{profile.label}</option>)}
          </select>
        </div>
        <div className="audioShareOption">
          <input id="share-system-audio" type="checkbox" checked={shareAudio} onChange={(event) => setShareAudio(event.target.checked)} />
          <label htmlFor="share-system-audio"><strong>共享系统音频</strong><small>默认关闭以减少音视频同步缓冲；需要声音时再开启</small></label>
        </div>
        <div className="actions"><button className="primary" onClick={createRoom}>分享屏幕并创建房间</button></div>
        <div className="joinBox">
          <input aria-label="房间码" value={joinCode} onChange={(event) => setJoinCode(event.target.value.toUpperCase().replace(/[^2-9A-Z]/g, "").slice(0, 6))} placeholder="输入 6 位房间码" maxLength={6} />
          <div className="roleChoice"><button className={requestedRole === "controller" ? "selected" : ""} onClick={() => setRequestedRole("controller")}>申请操作</button><button className={requestedRole === "spectator" ? "selected" : ""} onClick={() => setRequestedRole("spectator")}>只看直播</button></div>
          <button className="secondary joinButton" onClick={joinRoom}>加入房间</button>
        </div>
        {notice && <p className="notice" role="alert">{notice}</p>}
      </section>
      <section className="how"><div><b>01</b><strong>本地信令</strong><p>短房间码代替复制粘贴 SDP。</p></div><div><b>02</b><strong>逐人授权</strong><p>房主批准操作权限或只读观战。</p></div><div><b>03</b><strong>质量可见</strong><p>查看延迟、码率、帧率和丢包。</p></div></section>
    </>}

    {role && <section className="workspace">
      <div className="workspaceTitle"><div><span className="rolePill">{role === "host" ? "房主" : peerRole === "controller" ? "远端操作者" : "观众"}</span><h1>{role === "host" ? `房间 ${roomCode || "······"}` : `加入 ${roomCode || joinCode}`}</h1></div><button className="textButton" onClick={role === "host" ? closeHostedRoom : reset}>{role === "host" ? "关闭房间" : "退出房间"}</button></div>
      <div className="connectionBar"><span className={connected ? "dot online" : "dot"} />{status}<span className="secure">{connectedPeers} 个连接 · {turnStatus} · {mediaPath} · DTLS / SRTP</span></div>
      <div className="qualityBar"><div><span>网络 RTT</span><strong>{quality.rtt == null ? "—" : `${quality.rtt} ms`}</strong></div><div className="videoDelayMetric" title="精确值依赖浏览器提供 captureTime；不支持时以接收缓冲作为可确认的延迟下限"><span>画面延迟</span><strong>{quality.videoDelay != null ? `${quality.videoDelay} ms` : quality.jitterBuffer != null ? `≥ ${quality.jitterBuffer} ms` : "—"}</strong><small>{quality.jitterBuffer == null ? "缓冲 —" : `缓冲 ${quality.jitterBuffer} · 最低 ${quality.jitterBufferMinimum ?? "—"} · 目标 ${quality.jitterBufferTarget ?? "—"} · 解码 ${quality.decodeTime ?? "—"} ms`}</small></div><div><span>视频码率</span><strong>{quality.bitrate ? `${quality.bitrate} kbps` : "—"}</strong></div><div><span>帧率</span><strong>{quality.fps == null ? "—" : `${Math.round(quality.fps)} fps`}</strong></div><div><span>近 2 秒丢包</span><strong>{quality.lost}</strong></div></div>
      <div className="grid">
        <div>
          <div className="stage videoStage">
            <div className="stageHeader"><span><i className={connected ? "live" : ""} /> {connected ? "实时画面" : "等待连接"}</span>{role === "guest" ? <div className="viewerTools"><button aria-label="缩小" disabled={zoom <= 1} onClick={() => setZoom((value) => Math.max(1, value - 0.25))}>−</button><b>{Math.round(zoom * 100)}%</b><button aria-label="放大" disabled={zoom >= 2.5} onClick={() => setZoom((value) => Math.min(2.5, value + 0.25))}>＋</button><button onClick={() => void toggleVideoFullscreen()}>全屏</button></div> : <div className="hostShareTools"><span>正在向 {connectedPeers} 人分享</span><button disabled={isChangingShare} onClick={changeSharedWindow}>{isChangingShare ? "等待选择…" : "更换共享窗口"}</button></div>}</div>
            <div className="videoViewport" ref={videoViewportRef}>
              {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex -- 这是接收完整鼠标与键盘输入的远程应用画布。 */}
              <div className={`videoWrap ${role === "guest" ? canGuestControl ? "controlActive" : "controlLocked" : ""}`} role="application" aria-label={role === "guest" ? canGuestControl ? "远程控制画面" : "只读实时画面" : "房主共享画面"} style={{ aspectRatio: videoAspect, width: role === "guest" ? `${zoom * 100}%` : "100%" }} tabIndex={canGuestControl ? 0 : -1}
                onPointerMove={canGuestControl ? (event) => pointerEvent(event, "pointer") : undefined}
                onPointerDown={canGuestControl ? (event) => { event.preventDefault(); event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId); pointerEvent(event, "pointer-down"); } : undefined}
                onPointerUp={canGuestControl ? (event) => { event.preventDefault(); pointerEvent(event, "pointer-up"); if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); } : undefined}
                onPointerCancel={canGuestControl ? (event) => pointerEvent(event, "pointer-up") : undefined}
                onContextMenu={canGuestControl ? (event) => event.preventDefault() : undefined}
                onKeyDown={canGuestControl ? (event) => { event.preventDefault(); sendControl({ type: "key-down", key: event.key, code: event.code, keyCode: event.keyCode, location: event.location, repeat: event.repeat, altKey: event.altKey, ctrlKey: event.ctrlKey, metaKey: event.metaKey, shiftKey: event.shiftKey }); } : undefined}
                onKeyUp={canGuestControl ? (event) => { event.preventDefault(); sendControl({ type: "key-up", key: event.key, code: event.code, keyCode: event.keyCode, location: event.location, altKey: event.altKey, ctrlKey: event.ctrlKey, metaKey: event.metaKey, shiftKey: event.shiftKey }); } : undefined}>
                {/* 屏幕共享流没有可供网页提供的字幕轨道。 */}
                {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                <video ref={role === "host" ? localVideoRef : remoteVideoRef} autoPlay playsInline muted={role === "host"} onLoadedMetadata={(event) => syncVideoAspect(event.currentTarget)} onResize={(event) => syncVideoAspect(event.currentTarget)} />
                {role === "host" && remotePointer.visible && <div className={`remoteCursor ${remotePointer.click ? "clicking" : ""}`} style={{ left: `${remotePointer.x * 100}%`, top: `${remotePointer.y * 100}%` }}><span>远程</span></div>}
                {role === "guest" && !connected && <div className="videoPlaceholder"><div className="radar"><span>◎</span></div><strong>{status}</strong><small>连接建立后画面会自动出现</small></div>}
              </div>
              {role === "guest" && <div className={`mobileControlOverlay ${canGuestControl ? "" : "disabled"} ${mobileKeyboardOpen || mobileKeyEditorOpen ? "panelOpen" : ""}`} aria-label="悬浮触屏控制" onContextMenu={(event) => event.preventDefault()} onDragStart={(event) => event.preventDefault()}>
                <div className="mobileControlToolbar">
                  <button type="button" aria-expanded={mobileKeyboardOpen} onClick={() => { setMobileKeyboardOpen((open) => !open); setMobileKeyEditorOpen(false); }}>⌨ 键盘</button>
                  <button type="button" aria-expanded={mobileKeyEditorOpen} onClick={() => { setMobileKeyEditorOpen((open) => !open); setMobileKeyboardOpen(false); }}>⚙ 按键</button>
                </div>
                <div className="mobileQuickControls">
                  <div className="mobileDpad" aria-label="方向键">
                    <button type="button" className="dpadUp" aria-label="方向上" disabled={!canGuestControl} onPointerDown={(event) => pressVirtualButton(event, "{arrowup}")} onPointerUp={(event) => releaseVirtualButton(event, "{arrowup}")} onPointerCancel={(event) => releaseVirtualButton(event, "{arrowup}")}>↑</button>
                    <button type="button" className="dpadLeft" aria-label="方向左" disabled={!canGuestControl} onPointerDown={(event) => pressVirtualButton(event, "{arrowleft}")} onPointerUp={(event) => releaseVirtualButton(event, "{arrowleft}")} onPointerCancel={(event) => releaseVirtualButton(event, "{arrowleft}")}>←</button>
                    <span aria-hidden="true" />
                    <button type="button" className="dpadRight" aria-label="方向右" disabled={!canGuestControl} onPointerDown={(event) => pressVirtualButton(event, "{arrowright}")} onPointerUp={(event) => releaseVirtualButton(event, "{arrowright}")} onPointerCancel={(event) => releaseVirtualButton(event, "{arrowright}")}>→</button>
                    <button type="button" className="dpadDown" aria-label="方向下" disabled={!canGuestControl} onPointerDown={(event) => pressVirtualButton(event, "{arrowdown}")} onPointerUp={(event) => releaseVirtualButton(event, "{arrowdown}")} onPointerCancel={(event) => releaseVirtualButton(event, "{arrowdown}")}>↓</button>
                  </div>
                  <div className="mobileActionCluster">
                    {customVirtualKeys.length > 0 && <div className="mobileCustomKeys">{customVirtualKeys.map((button) => <button type="button" key={button} disabled={!canGuestControl} onPointerDown={(event) => pressVirtualButton(event, button)} onPointerUp={(event) => releaseVirtualButton(event, button)} onPointerCancel={(event) => releaseVirtualButton(event, button)}>{customVirtualKeyLabels[button]}</button>)}</div>}
                    <div className="mobileDefaultActions">
                      <button type="button" disabled={!canGuestControl} onPointerDown={(event) => pressVirtualButton(event, "{esc}")} onPointerUp={(event) => releaseVirtualButton(event, "{esc}")} onPointerCancel={(event) => releaseVirtualButton(event, "{esc}")}>ESC</button>
                      <button type="button" className="mobileSpaceButton" disabled={!canGuestControl} onPointerDown={(event) => pressVirtualButton(event, "{space}")} onPointerUp={(event) => releaseVirtualButton(event, "{space}")} onPointerCancel={(event) => releaseVirtualButton(event, "{space}")}>SPACE</button>
                      <button type="button" disabled={!canGuestControl} onPointerDown={(event) => pressVirtualButton(event, "{enter}")} onPointerUp={(event) => releaseVirtualButton(event, "{enter}")} onPointerCancel={(event) => releaseVirtualButton(event, "{enter}")}>ENTER</button>
                    </div>
                  </div>
                </div>
                {mobileKeyboardOpen && <div className="mobileControlPanel mobileKeyboardPanel">
                  <div className="mobileKeyboardHeader"><strong>完整键盘</strong><button type="button" aria-label="关闭完整键盘" onClick={() => setMobileKeyboardOpen(false)}>×</button></div>
                  <Keyboard
                    layout={virtualKeyboardLayout}
                    layoutName={keyboardLayoutName}
                    onKeyPress={pressVirtualKey}
                    onKeyReleased={releaseVirtualKey}
                    disableButtonHold
                    preventMouseDownDefault
                    stopMouseDownPropagation
                    stopMouseUpPropagation
                    theme="hg-theme-default mutinyKeyboard"
                    display={{
                      "{bksp}": "⌫", "{enter}": "ENTER", "{shift}": "SHIFT", "{esc}": "ESC",
                      "{arrowleft}": "←", "{arrowup}": "↑", "{arrowdown}": "↓", "{arrowright}": "→", "{space}": "SPACE",
                    }}
                    buttonTheme={[
                      { class: "remoteDirectionKey", buttons: "{arrowleft} {arrowup} {arrowdown} {arrowright}" },
                      { class: "remoteActionKey", buttons: "{esc} {enter} {space}" },
                      { class: "remoteSpaceKey", buttons: "{space}" },
                    ]}
                  />
                  <input aria-label="使用系统键盘发送文字到远端应用" disabled={!canGuestControl} inputMode="text" enterKeyHint="done" placeholder="点此使用手机系统键盘输入文字" onInput={(event) => { const inputEvent = event.nativeEvent as InputEvent; if (inputEvent.isComposing) return; sendRemoteText(event.currentTarget.value); event.currentTarget.value = ""; }} />
                </div>}
                {mobileKeyEditorOpen && <div className="mobileControlPanel mobileKeyEditor">
                  <div className="mobileKeyboardHeader"><strong>自定义悬浮按键</strong><button type="button" aria-label="关闭按键编辑器" onClick={() => setMobileKeyEditorOpen(false)}>×</button></div>
                  <p>选择最多 12 个游戏按键；方向键、Enter、Esc 和 Space 会始终显示。</p>
                  <div className="mobileKeyPicker">{customVirtualKeyOptions.map(({ button, label }) => {
                    const selected = customVirtualKeys.includes(button);
                    return <button type="button" key={button} className={selected ? "selected" : ""} aria-pressed={selected} disabled={!selected && customVirtualKeys.length >= 12} onClick={() => toggleCustomVirtualKey(button)}>{label}</button>;
                  })}</div>
                </div>}
              </div>}
            </div>
          </div>
          <div className="commandLog"><span>最近操作</span><strong>{lastCommand}</strong></div>
        </div>

        <aside className="panel roomPanel">
          <div className="turnCard free"><span>{controlLabel}</span><strong>{controlTitle}</strong><p>{controlDescription}</p>{role === "host" && control?.phase === "calibration" && <button className="reclaimButton" onClick={cancelHostCalibration}>取消本次校准</button>}</div>
          {role === "host" ? <>
            <div className="roomCode"><span>房间码</span><strong>{roomCode || "······"}</strong><small>同一局域网或能访问此信令服务的浏览器均可加入</small></div>
            <h2>成员与权限 <em>{peers.length}/8</em></h2>
            {!peers.length && <p className="emptyText">还没有访客，等待朋友输入房间码。</p>}
            {pendingPeers.map((peer) => <div className="peer pending" key={peer.peerId}><div><strong>{peer.name}</strong><small>申请：{peer.role === "controller" ? "操作" : "观战"}</small></div><div className="peerActions"><button onClick={() => approve(peer.peerId, "controller")}>设为操作者</button><button onClick={() => approve(peer.peerId, "spectator")}>仅观战</button><button className="danger" onClick={() => sendSignal({ type: "reject-peer", peerId: peer.peerId })}>拒绝</button></div></div>)}
            {approvedPeers.map((peer) => <div className="peer" key={peer.peerId}><div><strong>{peer.name}</strong><small>{peer.role === "controller" ? control?.phase === "calibration" && control.ownerPeerId === peer.peerId ? "等待其点击校准点" : control?.phase === "playing" ? "可持续操作" : "已获操作权限" : "只读观战"}</small></div><div className="peerActions memberActions">{peer.role === "controller" && <button disabled={!browserTargetReady || control?.phase === "calibration"} onClick={() => startHostCalibration(peer.peerId)}>{control?.phase === "ready" || control?.phase === "playing" ? "重新校准" : "开始校准"}</button>}<button className="roleToggle" onClick={() => setRemoteRole(peer.peerId, peer.role === "controller" ? "spectator" : "controller")}>{peer.role === "controller" ? "改为观战" : "设为操作者"}</button></div></div>)}
            <div className="companionBox">
              <h2>浏览器 / Windows 应用控制助手</h2>
              <p>运行 <code>npm run companion:arm</code> 后，可锁定 Chromium 标签页或任意可见 Windows 应用窗口。原生窗口模式会移动系统鼠标，请只授权可信访客。</p>
              <div><input value={companionCode} onChange={(event) => setCompanionCode(event.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="授权码" maxLength={6} /><button disabled={companionCode.length !== 6 || companionState === "connecting"} onClick={connectCompanion}>{companionState === "connecting" ? "连接中…" : companionState === "ready" ? "重新连接" : "连接"}</button></div>
              {companionState === "ready" && <>
                <div className="targetPicker"><select aria-label="选择要控制的浏览器页面或应用窗口" value={browserTargetId} onChange={(event) => selectBrowserTarget(event.target.value)}><option value="">选择控制目标</option><optgroup label="Chromium 标签页">{browserTargets.filter((target) => target.kind === "browser").map((target) => <option key={target.id} value={target.id}>{target.title || target.url}</option>)}</optgroup><optgroup label="Windows 应用窗口">{browserTargets.filter((target) => target.kind === "window").map((target) => <option key={target.id} value={target.id}>{target.title}</option>)}</optgroup></select><button aria-label="刷新控制目标列表" onClick={() => companionRef.current?.send(JSON.stringify({ type: "refresh-targets" }))}>刷新</button></div>
                <div className="calibrationGate"><strong>{calibrationState === "point-1" || calibrationState === "point-2" ? `正在为 ${control?.ownerName || "远端操作者"} 校准` : browserTargetReady ? nativeTarget ? "窗口坐标可自动映射" : "等待房主选择操作者" : "校准尚未就绪"}</strong><small>{calibrationState === "point-1" ? "目标已置前，请远端点击共享画面中的定位点 1 / 2" : calibrationState === "point-2" ? "请远端点击共享画面中的定位点 2 / 2" : calibrationState === "complete" ? "坐标映射完成，现在可以启用控制" : browserTargetReady ? nativeTarget ? "在成员列表点击“开始校准”，窗口会置前并自动完成映射" : "在成员列表选择操作者并由房主发起两点校准" : "请先选择并锁定一个控制目标"}</small>{control?.phase === "calibration" && <div className="calibrationActions"><button onClick={restartHostCalibration}>重新开始校准</button><button className="cancelButton" onClick={cancelHostCalibration}>取消校准</button></div>}</div>
                <div className={`controlGate ${desktopControlEnabled ? "armed" : ""}`}><button disabled={!browserTargetReady || (!desktopControlEnabled && control?.phase !== "ready" && control?.phase !== "playing")} onClick={toggleDesktopControl}>{desktopControlEnabled ? "停止远程控制" : "启用远程控制"}</button><small>{desktopControlEnabled ? `事件只会发送到当前锁定的${nativeTarget ? "应用窗口（系统鼠标会移动）" : "浏览器标签页"}${browserViewport ? `（${browserViewport.width} × ${browserViewport.height}）` : ""}` : browserTargetReady ? `安全预览模式；目标尺寸 ${browserViewport ? `${browserViewport.width} × ${browserViewport.height}` : "已读取"}` : "请先选择并锁定一个控制目标"}</small></div>
              </>}
            </div>
          </> : <>
            <div className="roomCode"><span>当前房间</span><strong>{roomCode || joinCode}</strong><small>{peerRole === "controller" ? control?.phase === "calibration" && hasControl ? "房主已发起校准，请按提示操作" : canGuestControl ? "远程控制已启用" : control?.phase === "setup" ? "等待房主发起校准" : "等待房主启用远程控制" : "你处于只读观战模式"}</small></div>
            {peerRole === "controller" && control?.phase === "setup" && <div className="calibrationGate remoteCalibration"><strong>校准由房主控制</strong><small>等待房主连接助手、选择控制目标并为你发起校准。</small></div>}
            {peerRole === "controller" && control?.phase === "calibration" && hasControl && <div className="calibrationGate remoteCalibration"><strong>{control.calibrationMessage || (control.calibrationStep === "point-2" ? "请点击第 2 个定位点" : "请点击第 1 个定位点")}</strong><small>只需按提示点击定位点；重新开始和取消由房主操作。</small></div>}
            <div className={`permissionCard ${peerRole}`}><b>{peerRole === "controller" ? control?.phase === "calibration" && hasControl ? "CAL" : canGuestControl ? "PLAY" : "WAIT" : "VIEW"}</b><strong>{peerRole === "controller" ? control?.phase === "calibration" && hasControl ? "校准中" : canGuestControl ? "远端控制" : "等待启用控制" : "只读观战"}</strong><p>{peerRole === "controller" ? control?.phase === "calibration" && hasControl ? "Windows 应用会自动映射；Chromium 目标请依次点击两个定位点。" : canGuestControl ? "移动和点击视频画面，聚焦后可使用键盘。" : "视频仍可观看，但鼠标和键盘事件不会发送。" : "房主可以把你设为远端操作者。"}</p></div>
          </>}
          {notice && <p className="notice smallNotice" role="alert">{notice}</p>}
          <div className="privacy"><span>◆</span><p><strong>本地信令，点对点媒体</strong><br />服务器只交换连接信息，不保存画面；多人观战时房主会为每人上传一路视频。</p></div>
        </aside>
      </div>
      <p className="limitation">控制助手和 Chromium 调试端口均只监听本机地址，并且每次启动都需要新的授权码。分享应用时，请在浏览器共享选择器与控制助手中选择同一个窗口；Windows 原生模式不会屏蔽房主本地输入。</p>
    </section>}
  </main>;
}
