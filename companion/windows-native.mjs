import { spawn } from "node:child_process";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

const nativeErrors = new Map([
  ["TARGET_CLOSED", "目标窗口已经关闭"],
  ["ACTIVATION_FAILED", "无法把目标窗口切换到前台；请在房主电脑上点击一次该窗口后重试"],
  ["TARGET_COVERED", "目标窗口仍被其他窗口覆盖；请关闭置顶窗口后由房主重新校准"],
  ["UNKNOWN_COMMAND", "未知原生命令"],
  ["SEND_INPUT_FAILED", "Windows 拒绝了键盘输入；请确认目标应用与助手权限级别一致"],
]);

function nativeErrorMessage(message) {
  return nativeErrors.get(String(message || "").trim()) || String(message || "Windows 原生输入失败").trim();
}

export class WindowsNativeHost {
  constructor() {
    this.nextId = 1;
    this.pending = new Map();
    this.process = null;
    this.stderr = "";
  }

  start() {
    if (process.platform !== "win32") return false;
    if (this.process) return true;
    const child = spawn("powershell.exe", [
      "-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
      "-File", fileURLToPath(new URL("./windows-native-host.ps1", import.meta.url)),
    ], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    this.process = child;
    this.stderr = "";
    child.stderr.on("data", (chunk) => { this.stderr = `${this.stderr}${chunk}`.slice(-4000); });
    readline.createInterface({ input: child.stdout }).on("line", (line) => {
      let message;
      try { message = JSON.parse(line); } catch { return; }
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.ok) pending.resolve(message);
      else pending.reject(new Error(nativeErrorMessage(message.error)));
    });
    child.once("error", (error) => {
      this.stderr = error.message;
    });
    child.once("exit", (code) => {
      if (this.process === child) this.process = null;
      const detail = this.stderr.trim();
      const reason = detail
        ? `Windows 原生输入助手已停止：${detail}`
        : `Windows 原生输入助手已停止${code == null ? "" : `（退出码 ${code}）`}`;
      for (const pending of this.pending.values()) pending.reject(new Error(reason));
      this.pending.clear();
    });
    return true;
  }

  send(command) {
    if (!this.start()) return Promise.reject(new Error("原生应用控制目前仅支持 Windows 房主"));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.process.stdin.write(`${JSON.stringify({ id, ...command })}\n`, (error) => {
        if (!error || !this.pending.has(id)) return;
        this.pending.delete(id);
        reject(new Error(`无法向 Windows 原生输入助手发送命令：${error.message}`));
      });
    });
  }

  async list() { return (await this.send({ command: "list" })).windows || []; }
  bounds(handle) { return this.send({ command: "bounds", handle }); }
  activate(handle) { return this.send({ command: "activate", handle }); }
  pointer(handle, message, action, surface = "window") {
    return this.send({ command: "pointer", handle, x: Number(message.x), y: Number(message.y), button: Number(message.button) || 0, action, surface });
  }
  key(handle, virtualKey, code, down) { return this.send({ command: "key", handle, virtualKey, code, down }); }
  text(handle, text) { return this.send({ command: "text", handle, text: String(text || "") }); }
  close() { this.process?.kill(); this.process = null; }
}
