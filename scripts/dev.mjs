import { spawn } from "node:child_process";

const node = process.execPath;
const children = [
  spawn(node, ["server/signaling.mjs"], { stdio: "inherit", env: process.env }),
  spawn(node, ["node_modules/vinext/dist/cli.js", "dev"], { stdio: "inherit", env: process.env }),
];

let closing = false;
function shutdown(code = 0) {
  if (closing) return;
  closing = true;
  for (const child of children) child.kill();
  setTimeout(() => process.exit(code), 200).unref();
}

for (const child of children) child.on("exit", (code) => { if (!closing && code) shutdown(code); });
process.on("SIGINT", () => shutdown());
process.on("SIGTERM", () => shutdown());
