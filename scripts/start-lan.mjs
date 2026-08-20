import { spawn } from "node:child_process";

const node = process.execPath;
const children = [
  spawn(node, ["server/signaling.mjs"], { stdio: "inherit", env: process.env }),
  spawn(node, ["node_modules/vinext/dist/cli.js", "start", "--hostname", "127.0.0.1", "--port", process.env.WEB_PORT || "3000"], { stdio: "inherit", env: process.env }),
  spawn(node, ["server/lan-proxy.mjs"], { stdio: "inherit", env: process.env }),
];

let closing = false;
function shutdown(code = 0) {
  if (closing) return;
  closing = true;
  for (const child of children) child.kill("SIGTERM");
  setTimeout(() => process.exit(code), 300).unref();
}
for (const child of children) child.on("exit", (code) => { if (!closing && code) shutdown(code); });
process.on("SIGINT", () => shutdown());
process.on("SIGTERM", () => shutdown());
