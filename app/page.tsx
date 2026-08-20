import Link from "next/link";

export default function ModeSelection() {
  return <main className="shell">
    <nav className="topbar">
      <div className="brand"><span className="brandMark">M</span><span>Mutiny Relay</span></div>
      <span className="prototypeTag">REMOTE PLAY · 模式选择</span>
    </nav>
    <section className="hero modeHero">
      <div className="eyebrow">CHOOSE YOUR SESSION</div>
      <h1>共享一个画面，<br />选择一种玩法</h1>
      <p>通用模式适合协作操作任意网页；红蓝回合模式提供独立校准、输入锁、60 秒倒计时和自动交棒。</p>
      <div className="modeGrid">
        <Link href="/free"><span>FREE CONTROL</span><strong>通用远程协作</strong><p>无倒计时、无阵营轮换。房主授权后，远端操作者可以持续控制共享页面。</p><b>进入通用模式 →</b></Link>
        <Link href="/turns"><span>TURN BASED</span><strong>红蓝回合对战</strong><p>红方远程校准，蓝方固定先手；双方每回合 60 秒，结束或归零后自动交棒。</p><b>进入回合模式 →</b></Link>
      </div>
    </section>
  </main>;
}
