"use client";

import { useEffect, useRef, useState } from "react";

type Role = "host" | "guest" | null;
type Signal = RTCSessionDescriptionInit;
type RemoteEvent = { type: "pointer" | "click" | "key"; x?: number; y?: number; key?: string };

const rtcConfig: RTCConfiguration = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
};

function encodeSignal(signal: Signal) {
  return btoa(unescape(encodeURIComponent(JSON.stringify(signal))));
}

function decodeSignal(value: string): Signal {
  return JSON.parse(decodeURIComponent(escape(atob(value.trim()))));
}

function waitForIce(pc: RTCPeerConnection) {
  if (pc.iceGatheringState === "complete") return Promise.resolve();
  return new Promise<void>((resolve) => {
    const listener = () => {
      if (pc.iceGatheringState === "complete") {
        pc.removeEventListener("icegatheringstatechange", listener);
        resolve();
      }
    };
    pc.addEventListener("icegatheringstatechange", listener);
  });
}

export default function Home() {
  const [role, setRole] = useState<Role>(null);
  const [status, setStatus] = useState("尚未连接");
  const [offerCode, setOfferCode] = useState("");
  const [answerCode, setAnswerCode] = useState("");
  const [inputCode, setInputCode] = useState("");
  const [notice, setNotice] = useState("");
  const [remotePointer, setRemotePointer] = useState({ x: 0.5, y: 0.5, visible: false, click: false });
  const [lastCommand, setLastCommand] = useState("等待访客操作");
  const [copied, setCopied] = useState("");
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const channelRef = useRef<RTCDataChannel | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => () => {
    channelRef.current?.close();
    pcRef.current?.close();
    streamRef.current?.getTracks().forEach((track) => track.stop());
  }, []);

  useEffect(() => {
    if (role === "host" && localVideoRef.current && streamRef.current) {
      localVideoRef.current.srcObject = streamRef.current;
    }
  }, [role]);

  const receiveCommand = (message: MessageEvent<string>) => {
    const event = JSON.parse(message.data) as RemoteEvent;
    if (event.type === "pointer") {
      setRemotePointer((old) => ({ ...old, x: event.x ?? 0.5, y: event.y ?? 0.5, visible: true }));
    }
    if (event.type === "click") {
      setRemotePointer({ x: event.x ?? 0.5, y: event.y ?? 0.5, visible: true, click: true });
      setLastCommand(`访客点击了画面 ${Math.round((event.x ?? 0) * 100)}% × ${Math.round((event.y ?? 0) * 100)}%`);
      window.setTimeout(() => setRemotePointer((old) => ({ ...old, click: false })), 260);
    }
    if (event.type === "key") setLastCommand(`访客按下了 ${event.key}`);
  };

  const bindConnection = (pc: RTCPeerConnection) => {
    pc.onconnectionstatechange = () => {
      const labels: Record<string, string> = {
        connected: "已建立点对点连接", connecting: "正在连接…", disconnected: "连接已中断",
        failed: "连接失败", closed: "连接已关闭", new: "等待连接",
      };
      setStatus(labels[pc.connectionState] ?? pc.connectionState);
    };
    pc.ontrack = (event) => {
      if (remoteVideoRef.current) remoteVideoRef.current.srcObject = event.streams[0];
    };
  };

  const createRoom = async () => {
    setNotice("");
    if (!navigator.mediaDevices?.getDisplayMedia) {
      setNotice("当前浏览器不支持屏幕分享，请使用新版 Chrome、Edge 或 Firefox。"); return;
    }
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio: true });
      streamRef.current = stream;
      if (localVideoRef.current) localVideoRef.current.srcObject = stream;
      const pc = new RTCPeerConnection(rtcConfig);
      pcRef.current = pc;
      bindConnection(pc);
      stream.getTracks().forEach((track) => pc.addTrack(track, stream));
      stream.getVideoTracks()[0].onended = () => setStatus("屏幕分享已停止");
      const channel = pc.createDataChannel("controls", { ordered: false, maxRetransmits: 0 });
      channelRef.current = channel;
      channel.onopen = () => setStatus("已建立点对点连接");
      channel.onmessage = receiveCommand;
      await pc.setLocalDescription(await pc.createOffer());
      await waitForIce(pc);
      setOfferCode(encodeSignal(pc.localDescription!));
      setRole("host");
      setStatus("等待访客回应");
    } catch (error) {
      setNotice(error instanceof Error && error.name === "NotAllowedError" ? "你取消了屏幕分享。" : "创建房间失败，请重新尝试。");
    }
  };

  const openJoin = () => { setRole("guest"); setStatus("等待粘贴邀请文本"); setNotice(""); };

  const createAnswer = async () => {
    try {
      const pc = new RTCPeerConnection(rtcConfig);
      pcRef.current = pc;
      bindConnection(pc);
      pc.ondatachannel = (event) => {
        channelRef.current = event.channel;
        event.channel.onopen = () => setStatus("已建立点对点连接");
      };
      await pc.setRemoteDescription(decodeSignal(inputCode));
      await pc.setLocalDescription(await pc.createAnswer());
      await waitForIce(pc);
      setAnswerCode(encodeSignal(pc.localDescription!));
      setStatus("把回应文本发给房主");
    } catch { setNotice("邀请文本无效，请确认复制完整。 "); }
  };

  const acceptAnswer = async () => {
    try {
      await pcRef.current?.setRemoteDescription(decodeSignal(inputCode));
      setStatus("正在连接…");
      setInputCode("");
    } catch { setNotice("回应文本无效，请确认复制完整。"); }
  };

  const copy = async (value: string, label: string) => {
    await navigator.clipboard.writeText(value);
    setCopied(label); window.setTimeout(() => setCopied(""), 1500);
  };

  const send = (event: RemoteEvent) => {
    if (channelRef.current?.readyState === "open") channelRef.current.send(JSON.stringify(event));
  };

  const pointerEvent = (event: React.PointerEvent<HTMLDivElement>, type: "pointer" | "click") => {
    const rect = event.currentTarget.getBoundingClientRect();
    send({ type, x: (event.clientX - rect.left) / rect.width, y: (event.clientY - rect.top) / rect.height });
  };

  const reset = () => {
    channelRef.current?.close(); pcRef.current?.close(); streamRef.current?.getTracks().forEach((track) => track.stop());
    channelRef.current = null; pcRef.current = null; streamRef.current = null;
    setRole(null); setStatus("尚未连接"); setOfferCode(""); setAnswerCode(""); setInputCode(""); setNotice("");
  };

  const connected = pcRef.current?.connectionState === "connected";

  return (
    <main className="shell">
      <nav className="topbar">
        <div className="brand"><span className="brandMark">M</span><span>Mutiny Relay</span></div>
        <span className="prototypeTag">远程同屏原型</span>
      </nav>

      {!role && <section className="hero">
        <div className="eyebrow">PEER-TO-PEER · 无需注册</div>
        <h1>把游戏画面<br />分享给朋友</h1>
        <p>房主分享游戏窗口，朋友通过一次性连接文本加入。视频和操作指令直接在两台设备之间加密传输。</p>
        <div className="actions">
          <button className="primary" onClick={createRoom}>创建房间</button>
          <button className="secondary" onClick={openJoin}>加入房间</button>
        </div>
        {notice && <p className="notice" role="alert">{notice}</p>}
      </section>}

      {role && <section className="workspace">
        <div className="workspaceTitle">
          <div><span className="rolePill">{role === "host" ? "房主" : "访客"}</span><h1>{role === "host" ? "你的共享画面" : "朋友的游戏画面"}</h1></div>
          <button className="textButton" onClick={reset}>退出房间</button>
        </div>
        <div className="connectionBar"><span className={connected ? "dot online" : "dot"} />{status}<span className="secure">DTLS / SRTP 加密</span></div>
        <div className="grid">
          <div>
            <div className="stage videoStage" tabIndex={role === "guest" ? 0 : -1}
              onPointerMove={role === "guest" ? (e) => pointerEvent(e, "pointer") : undefined}
              onClick={role === "guest" ? (e) => pointerEvent(e, "click") : undefined}
              onKeyDown={role === "guest" ? (e) => send({ type: "key", key: e.key }) : undefined}>
              <div className="stageHeader"><span><i className={connected ? "live" : ""} /> {status}</span><span>{role === "guest" ? "点击画面发送指针" : "正在预览分享内容"}</span></div>
              <div className="videoWrap">
                <video ref={role === "host" ? localVideoRef : remoteVideoRef} autoPlay playsInline muted={role === "host"} />
                {role === "host" && remotePointer.visible && <div className={`remoteCursor ${remotePointer.click ? "clicking" : ""}`} style={{ left: `${remotePointer.x * 100}%`, top: `${remotePointer.y * 100}%` }}><span>访客</span></div>}
                {!streamRef.current && role === "guest" && !connected && <div className="videoPlaceholder"><div className="radar"><span>◎</span></div><strong>等待画面连接</strong><small>先完成右侧的连接步骤</small></div>}
              </div>
            </div>
            <div className="commandLog"><span>最近操作</span><strong>{lastCommand}</strong></div>
          </div>

          <aside className="panel">
            {role === "host" ? <>
              <div className="step active"><b>1</b><div><strong>分享邀请文本</strong><p>复制并通过聊天工具发给你的朋友。</p></div></div>
              <textarea aria-label="邀请文本" readOnly value={offerCode} placeholder="正在生成邀请…" />
              <button className="primary full" disabled={!offerCode} onClick={() => copy(offerCode, "offer")}>{copied === "offer" ? "已复制 ✓" : "复制邀请文本"}</button>
              <div className="divider"><span>然后</span></div>
              <div className="step"><b>2</b><div><strong>粘贴访客回应</strong><p>朋友会生成一段回应文本。</p></div></div>
              <textarea aria-label="访客回应" value={inputCode} onChange={(e) => setInputCode(e.target.value)} placeholder="在这里粘贴回应文本…" />
              <button className="secondary full" disabled={!inputCode} onClick={acceptAnswer}>完成连接</button>
            </> : <>
              {!answerCode ? <>
                <div className="step active"><b>1</b><div><strong>粘贴房主邀请</strong><p>把朋友发来的邀请文本粘贴到这里。</p></div></div>
                <textarea aria-label="房主邀请" value={inputCode} onChange={(e) => setInputCode(e.target.value)} placeholder="在这里粘贴邀请文本…" />
                <button className="primary full" disabled={!inputCode} onClick={createAnswer}>生成回应文本</button>
              </> : <>
                <div className="step active"><b>2</b><div><strong>把回应发给房主</strong><p>房主粘贴后，连接会自动建立。</p></div></div>
                <textarea aria-label="回应文本" readOnly value={answerCode} />
                <button className="primary full" onClick={() => copy(answerCode, "answer")}>{copied === "answer" ? "已复制 ✓" : "复制回应文本"}</button>
              </>}
            </>}
            {notice && <p className="notice smallNotice" role="alert">{notice}</p>}
            <div className="privacy"><span>◆</span><p><strong>内容不会上传到服务器</strong><br />连接文本只包含临时网络信息，不包含游戏画面。</p></div>
          </aside>
        </div>
        <p className="limitation">浏览器安全限制下，访客操作会显示为房主端的指针与按键提示；直接控制系统鼠标需要后续增加桌面端辅助程序。</p>
      </section>}

      {!role && <section className="how"><div><b>01</b><strong>房主分享窗口</strong><p>选择 Mutiny 游戏所在的标签页或窗口。</p></div><div><b>02</b><strong>交换连接文本</strong><p>通过任意聊天工具完成一次握手。</p></div><div><b>03</b><strong>朋友加入操作</strong><p>移动指针、点击并发送键盘按键。</p></div></section>}
    </main>
  );
}
