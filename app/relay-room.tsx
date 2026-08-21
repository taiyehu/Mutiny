"use client";

/* eslint-disable @next/next/no-html-link-for-pages -- vinext 1.0 beta 的 Link 在生产环境会触发 RSC 预取异常。 */

import { useCallback, useEffect, useRef, useState } from "react";

type AppRole = "host" | "guest" | null;
type PeerRole = "controller" | "spectator";
type Peer = { peerId: string; name: string; role: PeerRole; approved: boolean };
type RemoteEvent = { type: "pointer" | "pointer-down" | "pointer-up" | "click" | "key" | "key-down" | "key-up"; x?: number; y?: number; button?: number; buttons?: number; key?: string; code?: string; repeat?: boolean; altKey?: boolean; ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean };
type BrowserTarget = { id: string; title: string; url: string };
type Quality = { rtt: number | null; bitrate: number; fps: number | null; lost: number };
type IceServerMessage = { type: "ice-servers"; iceServers: RTCIceServer[]; turnEnabled: boolean; error?: string | null };
type ControlState = { ownerPeerId: string; ownerName: string; side: "blue" | "red"; mode: "free" | "turns"; calibrationReady: boolean; calibrationStep: "off" | "point-1" | "point-2" | "complete"; calibrationMessage: string | null; phase: "setup" | "calibration" | "ready" | "playing"; turnNumber: number; turnDeadline: number | null; leaseUntil: number };

const configuredSignalUrl = process.env.NEXT_PUBLIC_SIGNAL_URL;

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

export default function RelayRoom({ mode }: { mode: "free" | "turns" }) {
  const [role, setRole] = useState<AppRole>(null);
  const [peerRole, setPeerRole] = useState<PeerRole>("controller");
  const [requestedRole, setRequestedRole] = useState<PeerRole>("controller");
  const [name, setName] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [roomCode, setRoomCode] = useState("");
  const [status, setStatus] = useState("本地服务未连接");
  const [notice, setNotice] = useState("");
  const [peers, setPeers] = useState<Peer[]>([]);
  const [quality, setQuality] = useState<Quality>({ rtt: null, bitrate: 0, fps: null, lost: 0 });
  const [videoAspect, setVideoAspect] = useState(16 / 9);
  const [remotePointer, setRemotePointer] = useState({ x: 0.5, y: 0.5, visible: false, click: false });
  const [lastCommand, setLastCommand] = useState("等待访客操作");
  const [companionCode, setCompanionCode] = useState("");
  const [companionState, setCompanionState] = useState<"off" | "connecting" | "ready">("off");
  const [desktopControlEnabled, setDesktopControlEnabled] = useState(false);
  const [browserTargets, setBrowserTargets] = useState<BrowserTarget[]>([]);
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
  const [turnSecondsLeft, setTurnSecondsLeft] = useState<number | null>(null);

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
  const statsPreviousRef = useRef(new Map<string, { bytes: number; at: number }>());
  const pointerAtRef = useRef(0);
  const rtcConfigRef = useRef<RTCConfiguration>(defaultRtcConfig());
  const turnEnabledRef = useRef(false);
  const selfPeerIdRef = useRef("");
  const controlRef = useRef<ControlState | null>(null);
  const browserTargetReadyRef = useRef(false);
  const companionAttemptRef = useRef(0);
  const companionConnectedOnceRef = useRef(false);

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
    streamRef.current.getTracks().forEach((track) => pc.addTrack(track, streamRef.current!));
    const channel = pc.createDataChannel("controls", { ordered: false, maxRetransmits: 0 });
    bindChannel(peerId, channel);
    await pc.setLocalDescription(await pc.createOffer());
    sendSignal({ type: "signal", target: peerId, data: { description: pc.localDescription } });
  }, [bindChannel, bindPeer, sendSignal]);

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
      if (message.type === "room-created") { selfPeerIdRef.current = message.peerId; setSelfPeerId(message.peerId); setRoomCode(message.roomCode); setStatus("蓝方先手，等待访客"); }
      if (message.type === "join-pending") { selfPeerIdRef.current = message.peerId; setSelfPeerId(message.peerId); setRoomCode(message.roomCode); setStatus("等待房主批准"); }
      if (message.type === "join-approved") { setPeerRole(message.role); setStatus(message.role === "controller" ? "已获操作权限，正在连接" : "已进入观战模式，正在连接"); }
      if (message.type === "join-rejected") { setNotice(message.reason); setStatus("加入被拒绝"); }
      if (message.type === "room-state") {
        peersRef.current = message.peers;
        controlRef.current = message.control;
        setPeers(message.peers);
        setControl(message.control);
        setTurnSecondsLeft(message.control?.mode === "turns" && message.control?.phase === "playing" && message.control?.turnDeadline
          ? Math.max(0, Math.ceil((message.control.turnDeadline - Date.now()) / 1000))
          : null);
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
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio: true });
      streamRef.current = stream;
      stream.getVideoTracks()[0].onended = () => setStatus("屏幕分享已停止");
      setRole("host"); roleRef.current = "host";
      setStatus("正在连接本地信令服务");
      const socket = await connectSignaling();
      socket.send(JSON.stringify({ type: "create-room", name: name.trim() || "房主", mode }));
    } catch (error) {
      streamRef.current?.getTracks().forEach((track) => track.stop()); streamRef.current = null;
      setRole(null); roleRef.current = null;
      setNotice(error instanceof DOMException && error.name === "NotAllowedError" ? "你取消了屏幕分享。" : "无法连接本地信令服务，请先运行 npm run dev。");
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
      : state?.mode === "free"
        ? state.phase === "playing"
        : state?.phase === "playing" && state.ownerPeerId === selfPeerIdRef.current;
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

  const syncVideoAspect = (video: HTMLVideoElement) => {
    if (video.videoWidth > 0 && video.videoHeight > 0) setVideoAspect(video.videoWidth / video.videoHeight);
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
      socket.send(JSON.stringify({ type: "auth", code: companionCode.trim() }));
    };
    socket.onmessage = (event) => {
      if (companionAttemptRef.current !== attempt) return;
      const message = JSON.parse(event.data);
      if (message.type === "auth-ok") {
        if (message.protocol !== "cdp-page-v5") {
          socket.close();
          setCompanionState("off");
          setNotice("检测到旧版助手仍在运行。请在旧终端按 Ctrl+C，再重新运行 npm run companion:arm。");
          return;
        }
        desktopControlEnabledRef.current = false;
        setDesktopControlEnabled(false);
        setCompanionState("ready");
        setLastCommand("浏览器助手已连接，请选择目标标签页");
        if (companionConnectedOnceRef.current) {
          sendSignal({ type: "reset-control-session", reason: "房主页面助手已重新连接，上一轮控制状态已清除" });
        }
        companionConnectedOnceRef.current = true;
        socket.send(JSON.stringify({ type: "set-turn", remote: Boolean(controlRef.current && controlRef.current.ownerPeerId !== selfPeerIdRef.current) }));
      }
      if (message.type === "targets") {
        setBrowserTargets(message.targets);
        setBrowserTargetId((current) => {
          if (message.targets.some((target: BrowserTarget) => target.id === current)) return current;
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
        setLastCommand(`已锁定页面：${message.target.title || message.target.url}`);
        sendSignal({ type: "set-calibration-ready", ready: true });
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
        setNotice("目标标签页已关闭，请重新选择。");
      }
      if (message.type === "control-state") {
        desktopControlEnabledRef.current = message.enabled;
        setDesktopControlEnabled(message.enabled);
        setLastCommand(message.enabled ? "指定浏览器页面控制已开启" : "已切回仅预览指针");
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
      if (message.type === "cdp-error" || message.type === "input-error") setNotice(message.message);
      if (message.type === "auth-error") { setCompanionState("off"); setNotice("浏览器助手授权码不正确，可以修改后重新连接。"); socket.close(); }
    };
    socket.onerror = () => {
      if (companionAttemptRef.current !== attempt) return;
      setCompanionState("off");
      setNotice("无法连接浏览器助手，请先运行 npm run companion:arm，然后重试。");
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

  const requestCalibration = () => {
    setNotice("");
    sendSignal({ type: controlRef.current?.phase === "calibration" ? "restart-calibration" : "start-calibration" });
  };

  const cancelCalibration = () => sendSignal({ type: "cancel-calibration" });

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
    peersRef.current = []; selfPeerIdRef.current = ""; controlRef.current = null; desktopControlEnabledRef.current = false; calibrationActiveRef.current = false; turnEnabledRef.current = false; rtcConfigRef.current = defaultRtcConfig(); setDesktopControlEnabled(false); setBrowserTargets([]); setBrowserTargetId(""); setBrowserTargetReady(false); setBrowserViewport(null); setCalibrationState("off"); setZoom(1); setRole(null); roleRef.current = null; setRoomCode(""); setSelfPeerId(""); setControl(null); setTurnSecondsLeft(null); setPeers([]); setConnectedPeers(0); setTurnStatus("正在检查 ICE"); setMediaPath("等待连接"); setStatus("本地服务未连接"); setNotice(""); setCompanionState("off");
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
    if (control?.mode !== "turns" || control.phase !== "playing" || !control.turnDeadline) return;
    const update = () => setTurnSecondsLeft(Math.max(0, Math.ceil((control.turnDeadline! - Date.now()) / 1000)));
    const kickoff = window.setTimeout(update, 0);
    const timer = window.setInterval(update, 250);
    return () => { window.clearTimeout(kickoff); window.clearInterval(timer); };
  }, [control?.mode, control?.phase, control?.turnDeadline]);

  useEffect(() => {
    if (!role) return;
    const timer = window.setInterval(async () => {
      const entry = [...pcsRef.current.entries()][0];
      if (!entry) return setQuality({ rtt: null, bitrate: 0, fps: null, lost: 0 });
      const [peerId, pc] = entry;
      const reports = await pc.getStats();
      let bytes = 0, fps: number | null = null, lost = 0, rtt: number | null = null;
      let selectedPair;
      reports.forEach((report) => {
        if ((report.type === "inbound-rtp" || report.type === "outbound-rtp") && report.kind === "video") {
          bytes += report.bytesReceived ?? report.bytesSent ?? 0; fps = report.framesPerSecond ?? fps; lost += report.packetsLost ?? 0;
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
      statsPreviousRef.current.set(peerId, { bytes, at: now });
      setQuality({ rtt, bitrate, fps, lost });
    }, 2000);
    return () => window.clearInterval(timer);
  }, [role]);

  const connected = connectedPeers > 0;
  const pendingPeers = peers.filter((peer) => !peer.approved);
  const approvedPeers = peers.filter((peer) => peer.approved);
  const remoteControllers = approvedPeers.filter((peer) => peer.role === "controller");
  const hasControl = Boolean(selfPeerId && control?.ownerPeerId === selfPeerId);
  const activeMode = control?.mode ?? mode;
  const isTurnMode = activeMode === "turns";
  const canGuestControl = role === "guest" && peerRole === "controller" && Boolean(control && (
    control.phase === "calibration"
      ? hasControl
      : control.phase === "playing" && (control.mode === "free" || hasControl)
  ));
  const turnLabel = control?.phase === "calibration" ? "校准阶段" : control?.phase === "ready" ? "校准完成" : control?.phase === "playing" ? isTurnMode ? `第 ${control.turnNumber} 回合` : "自由控制" : "准备阶段";
  const turnTitle = control?.phase === "setup" ? "等待远端与校准" : control?.phase === "calibration" ? `远端校准 · ${control.ownerName}` : control?.phase === "ready" ? "等待启用页面控制" : !isTurnMode ? "通用远程控制已启用" : control?.side === "red" ? `红方 · ${control.ownerName}` : "蓝方 · 房主";
  const turnDescription = control?.phase === "setup" ? role === "host" ? "批准操作者、连接页面助手并选定标签页；随后由远端发起两点校准。" : control?.calibrationReady ? "助手页面已准备好，你可以在这里发起两点校准。" : "等待房主连接页面助手并选定目标标签页。" : control?.phase === "calibration" ? hasControl ? "请依次点击共享画面中的两个定位点；校准不计入正式回合。" : "正在等待远端完成两点校准，本地游戏输入已锁定。" : control?.phase === "ready" ? role === "host" ? isTurnMode ? "点击“启用页面控制”后，蓝方第 1 回合与 60 秒倒计时同时开始。" : "点击“启用页面控制”后，所有获准操作者均可持续控制。" : "校准已完成，等待房主启用页面控制。" : !isTurnMode ? "获准的远端操作者可以持续输入；此模式没有回合和倒计时。" : hasControl ? "轮到你操作；60 秒结束会自动交棒，也可以主动结束回合。" : "当前输入已锁定，请等待对方结束回合或倒计时归零。";

  return <main className="shell">
    <nav className="topbar">
      <div className="brand"><span className="brandMark">M</span><span>Mutiny Relay</span></div>
      <a className="prototypeTag" href="/">← 模式选择</a>
    </nav>

    {!role && <>
      <section className="hero compactHero">
        <div className="eyebrow">SHORT CODE · HOST APPROVAL · LIVE STATS</div>
        <h1>{isTurnMode ? "红蓝轮换，\n即开即玩" : "通用同屏，\n自由协作"}</h1>
        <p>{isTurnMode ? "双方在独立校准后按 60 秒回合轮流操作，蓝方房主固定先手。" : "不设回合和倒计时；所有获准操作者都可控制选定的 Chromium 页面。"}</p>
        <input className="nameInput" value={name} onChange={(event) => setName(event.target.value)} placeholder="你的昵称（可选）" maxLength={24} />
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
      <div className="workspaceTitle"><div><span className={`rolePill ${role === "host" ? "blueSide" : "redSide"}`}>{role === "host" ? isTurnMode ? "蓝方房主" : "房主" : peerRole === "controller" ? isTurnMode ? "红方玩家" : "远端操作者" : "观众"}</span><h1>{role === "host" ? `房间 ${roomCode || "······"}` : `加入 ${roomCode || joinCode}`}</h1></div><button className="textButton" onClick={role === "host" ? closeHostedRoom : reset}>{role === "host" ? "关闭房间" : "退出房间"}</button></div>
      <div className="connectionBar"><span className={connected ? "dot online" : "dot"} />{status}<span className="secure">{connectedPeers} 个连接 · {turnStatus} · {mediaPath} · DTLS / SRTP</span></div>
      <div className="qualityBar"><div><span>延迟</span><strong>{quality.rtt == null ? "—" : `${quality.rtt} ms`}</strong></div><div><span>视频码率</span><strong>{quality.bitrate ? `${quality.bitrate} kbps` : "—"}</strong></div><div><span>帧率</span><strong>{quality.fps == null ? "—" : `${Math.round(quality.fps)} fps`}</strong></div><div><span>丢包</span><strong>{quality.lost}</strong></div></div>
      <div className="grid">
        <div>
          <div className="stage videoStage">
            <div className="stageHeader"><span><i className={connected ? "live" : ""} /> {connected ? "实时画面" : "等待连接"}</span>{role === "guest" ? <div className="viewerTools"><button aria-label="缩小" disabled={zoom <= 1} onClick={() => setZoom((value) => Math.max(1, value - 0.25))}>−</button><b>{Math.round(zoom * 100)}%</b><button aria-label="放大" disabled={zoom >= 2.5} onClick={() => setZoom((value) => Math.min(2.5, value + 0.25))}>＋</button><button onClick={() => void videoViewportRef.current?.requestFullscreen()}>全屏</button></div> : <span>正在向 {connectedPeers} 人分享</span>}</div>
            <div className="videoViewport" ref={videoViewportRef}>
              {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex -- 这是接收完整鼠标与键盘输入的远程应用画布。 */}
              <div className={`videoWrap ${role === "guest" ? canGuestControl ? "turnActive" : "turnLocked" : ""}`} role="application" aria-label={role === "guest" ? canGuestControl ? "红方远程控制画面" : "等待回合的实时画面" : "房主共享画面"} style={{ aspectRatio: videoAspect, width: role === "guest" ? `${zoom * 100}%` : "100%" }} tabIndex={canGuestControl ? 0 : -1}
                onPointerMove={canGuestControl ? (event) => pointerEvent(event, "pointer") : undefined}
                onPointerDown={canGuestControl ? (event) => { event.preventDefault(); event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId); pointerEvent(event, "pointer-down"); } : undefined}
                onPointerUp={canGuestControl ? (event) => { event.preventDefault(); pointerEvent(event, "pointer-up"); if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); } : undefined}
                onPointerCancel={canGuestControl ? (event) => pointerEvent(event, "pointer-up") : undefined}
                onContextMenu={canGuestControl ? (event) => event.preventDefault() : undefined}
                onKeyDown={canGuestControl ? (event) => { event.preventDefault(); sendControl({ type: "key-down", key: event.key, code: event.code, repeat: event.repeat, altKey: event.altKey, ctrlKey: event.ctrlKey, metaKey: event.metaKey, shiftKey: event.shiftKey }); } : undefined}
                onKeyUp={canGuestControl ? (event) => { event.preventDefault(); sendControl({ type: "key-up", key: event.key, code: event.code, altKey: event.altKey, ctrlKey: event.ctrlKey, metaKey: event.metaKey, shiftKey: event.shiftKey }); } : undefined}>
                {/* 屏幕共享流没有可供网页提供的字幕轨道。 */}
                {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                <video ref={role === "host" ? localVideoRef : remoteVideoRef} autoPlay playsInline muted={role === "host"} onLoadedMetadata={(event) => syncVideoAspect(event.currentTarget)} onResize={(event) => syncVideoAspect(event.currentTarget)} />
                {role === "host" && remotePointer.visible && <div className={`remoteCursor ${remotePointer.click ? "clicking" : ""}`} style={{ left: `${remotePointer.x * 100}%`, top: `${remotePointer.y * 100}%` }}><span>远程</span></div>}
                {role === "guest" && !connected && <div className="videoPlaceholder"><div className="radar"><span>◎</span></div><strong>{status}</strong><small>连接建立后画面会自动出现</small></div>}
              </div>
            </div>
          </div>
          <div className="commandLog"><span>最近操作</span><strong>{lastCommand}</strong></div>
        </div>

        <aside className="panel roomPanel">
          <div className={`turnCard ${isTurnMode ? control?.side || "blue" : "free"}`}><span>{turnLabel}</span>{isTurnMode && control?.phase === "playing" && <b className={`turnClock ${(turnSecondsLeft ?? 60) <= 10 ? "urgent" : ""}`} aria-label="本回合剩余时间">{turnSecondsLeft ?? 60}<small>秒</small></b>}<strong>{turnTitle}</strong><p>{turnDescription}</p>{isTurnMode && control?.phase === "playing" && hasControl && (role === "host" ? <button disabled={!remoteControllers.length || !desktopControlEnabled} onClick={() => sendSignal({ type: "pass-control" })}>{!remoteControllers.length ? "等待红方操作者" : !desktopControlEnabled ? "请先启用页面控制" : "结束蓝方回合，交给红方"}</button> : peerRole === "controller" ? <button onClick={() => sendSignal({ type: "pass-control" })}>结束红方回合，交还蓝方</button> : null)}{role === "host" && control?.phase === "calibration" && !hasControl && <button className="reclaimButton" onClick={() => sendSignal({ type: "reclaim-control" })}>取消校准并收回</button>}</div>
          {role === "host" ? <>
            <div className="roomCode"><span>房间码</span><strong>{roomCode || "······"}</strong><small>同一局域网或能访问此信令服务的浏览器均可加入</small></div>
            <h2>成员与权限 <em>{peers.length}/8</em></h2>
            {!peers.length && <p className="emptyText">还没有访客，等待朋友输入房间码。</p>}
            {pendingPeers.map((peer) => <div className="peer pending" key={peer.peerId}><div><strong>{peer.name}</strong><small>申请：{peer.role === "controller" ? isTurnMode ? "红方" : "操作" : "观战"}</small></div><div className="peerActions"><button onClick={() => approve(peer.peerId, "controller")}>设为{isTurnMode ? "红方" : "操作者"}</button><button onClick={() => approve(peer.peerId, "spectator")}>仅观战</button><button className="danger" onClick={() => sendSignal({ type: "reject-peer", peerId: peer.peerId })}>拒绝</button></div></div>)}
            {approvedPeers.map((peer) => <div className="peer" key={peer.peerId}><div><strong>{peer.name}</strong><small>{peer.role === "controller" ? control?.phase === "calibration" && control.ownerPeerId === peer.peerId ? "正在完成校准" : !isTurnMode && control?.phase === "playing" ? "可持续操作" : control?.ownerPeerId === peer.peerId ? "红方正在操作" : "红方候选，等待轮换" : "只读观战"}</small></div><button className="roleToggle" onClick={() => setRemoteRole(peer.peerId, peer.role === "controller" ? "spectator" : "controller")}>{peer.role === "controller" ? "改为观战" : `设为${isTurnMode ? "红方" : "操作者"}`}</button></div>)}
            <div className="companionBox">
              <h2>Chromium 页面控制助手</h2>
              <p>先用远程调试端口启动一个独立 Chromium，再运行 <code>npm run companion:arm</code>。助手只向选定标签页发送事件，不会移动系统鼠标。</p>
              <div><input value={companionCode} onChange={(event) => setCompanionCode(event.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="授权码" maxLength={6} /><button disabled={companionCode.length !== 6 || companionState === "connecting"} onClick={connectCompanion}>{companionState === "connecting" ? "连接中…" : companionState === "ready" ? "重新连接" : "连接"}</button></div>
              {companionState === "ready" && <>
                <div className="targetPicker"><select aria-label="选择要控制的 Chromium 标签页" value={browserTargetId} onChange={(event) => selectBrowserTarget(event.target.value)}><option value="">选择目标标签页</option>{browserTargets.map((target) => <option key={target.id} value={target.id}>{target.title || target.url}</option>)}</select><button aria-label="刷新标签页列表" onClick={() => companionRef.current?.send(JSON.stringify({ type: "refresh-targets" }))}>刷新</button></div>
                <div className="calibrationGate"><strong>{calibrationState === "point-1" || calibrationState === "point-2" ? "远端正在校准" : browserTargetReady ? "等待远端发起校准" : "校准尚未就绪"}</strong><small>{calibrationState === "point-1" ? "请远端点击共享画面中的定位点 1 / 2" : calibrationState === "point-2" ? "请远端点击共享画面中的定位点 2 / 2" : calibrationState === "complete" ? "校准完成，现在可以启用页面控制" : browserTargetReady ? "校准按钮位于远端窗口，房主无需代为点击" : "请先选择并锁定一个目标标签页"}</small></div>
                <div className={`controlGate ${desktopControlEnabled ? "armed" : ""}`}><button disabled={!browserTargetReady || (!desktopControlEnabled && control?.phase !== "ready" && control?.phase !== "playing")} onClick={toggleDesktopControl}>{desktopControlEnabled ? "停止页面控制" : "启用页面控制"}</button><small>{desktopControlEnabled ? `事件只会发送到当前锁定的标签页${browserViewport ? `（${browserViewport.width} × ${browserViewport.height} CSS px）` : ""}` : browserTargetReady ? `安全预览模式；目标 viewport ${browserViewport ? `${browserViewport.width} × ${browserViewport.height} CSS px` : "已读取"}` : "请先选择并锁定一个目标标签页"}</small></div>
              </>}
            </div>
          </> : <>
            <div className="roomCode"><span>当前房间</span><strong>{roomCode || joinCode}</strong><small>{peerRole === "controller" ? control?.phase === "calibration" && hasControl ? "远端校准阶段" : canGuestControl ? isTurnMode ? "轮到红方，你可以操作" : "自由控制已启用" : control?.phase === "setup" && control.calibrationReady ? "页面已就绪，请开始校准" : isTurnMode ? "等待蓝方交出控制权" : "等待房主启用页面控制" : "你处于只读观战模式"}</small></div>
            {peerRole === "controller" && control?.phase === "setup" && <div className="calibrationGate remoteCalibration"><button disabled={!control.calibrationReady} onClick={requestCalibration}>开始两点校准</button><small>{control.calibrationReady ? "依次点击共享画面中的两个定位点；完成后由房主启用控制。" : "等待房主连接助手并选定目标标签页。"}</small></div>}
            {peerRole === "controller" && control?.phase === "calibration" && hasControl && <div className="calibrationGate remoteCalibration"><strong>{control.calibrationMessage || (control.calibrationStep === "point-2" ? "请点击第 2 个定位点" : "请点击第 1 个定位点")}</strong><div className="calibrationActions"><button onClick={requestCalibration}>重新开始校准</button><button className="cancelButton" onClick={cancelCalibration}>取消校准</button></div><small>失败后可以继续点击第一个定位点，也可以随时重新开始或取消；取消后不会保留输入锁。</small></div>}
            {peerRole === "controller" && (control?.phase === "ready" || control?.phase === "playing" && (!isTurnMode || hasControl)) && <div className="calibrationGate remoteCalibration"><button disabled={!control.calibrationReady} onClick={requestCalibration}>重新校准坐标</button><small>{control.calibrationReady ? "会暂停当前控制状态并重新进入独立校准阶段，完成后需要房主再次启用页面控制。" : "房主页面助手尚未准备好，暂时不能重新校准。"}</small></div>}
            <div className={`permissionCard ${peerRole}`}><b>{peerRole === "controller" ? control?.phase === "calibration" && hasControl ? "CAL" : canGuestControl ? "PLAY" : "WAIT" : "VIEW"}</b><strong>{peerRole === "controller" ? control?.phase === "calibration" && hasControl ? "两点校准" : canGuestControl ? isTurnMode ? "红方回合" : "远端控制" : isTurnMode ? "等待蓝方回合" : "等待启用控制" : "只读观战"}</strong><p>{peerRole === "controller" ? control?.phase === "calibration" && hasControl ? "依次点击两个定位点；正式控制尚未开始。" : canGuestControl ? isTurnMode ? "移动和点击视频画面，聚焦后可使用方向键；完成后点击结束回合。" : "移动和点击视频画面，聚焦后可使用键盘；通用模式不会自动收回控制。" : "视频仍可观看，但鼠标和键盘事件不会发送。" : `房主可以把你设为${isTurnMode ? "红方玩家" : "远端操作者"}。`}</p></div>
          </>}
          {notice && <p className="notice smallNotice" role="alert">{notice}</p>}
          <div className="privacy"><span>◆</span><p><strong>本地信令，点对点媒体</strong><br />服务器只交换连接信息，不保存画面；多人观战时房主会为每人上传一路视频。</p></div>
        </aside>
      </div>
      <p className="limitation">浏览器助手和 Chromium 调试端口均只监听本机地址，并且每次启动都需要新的授权码。建议只分享目标标签页，并为远程调试使用独立浏览器配置目录。</p>
    </section>}
  </main>;
}
