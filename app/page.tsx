export default function ModeSelection() {
  return <main className="shell">
    <nav className="topbar">
      <div className="brand"><span className="brandMark">M</span><span>Mutiny Relay</span></div>
      <span className="prototypeTag">REMOTE PLAY · 远程协作</span>
    </nav>
    <section className="hero modeHero">
      <div className="eyebrow">SHARE · APPROVE · CONTROL</div>
      <h1>共享一个画面，<br />安全远程协作</h1>
      <p>房主分享浏览器标签页、Windows 应用窗口或整个屏幕，并逐人批准观看与操作权限。</p>
      <div className="modeGrid">
        <a href="/free"><span>REMOTE COLLABORATION</span><strong>进入远程协作</strong><p>房主授权后，远端操作者可以持续控制共享页面或选定的 Windows 应用。</p><b>创建或加入房间 →</b></a>
      </div>
    </section>
  </main>;
}
