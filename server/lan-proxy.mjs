import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import net from "node:net";

const host = process.env.LAN_HOST || "0.0.0.0";
const port = Number(process.env.LAN_HTTPS_PORT || 3443);
const webPort = Number(process.env.WEB_PORT || 3000);
const signalPort = Number(process.env.SIGNAL_PORT || 8787);
const publicHttpHost = process.env.PUBLIC_HTTP_HOST || "127.0.0.1";
const publicHttpPort = Number(process.env.PUBLIC_HTTP_PORT || 0);
const keyPath = process.env.LAN_TLS_KEY;
const certPath = process.env.LAN_TLS_CERT;

if (!keyPath || !certPath) {
  console.error("缺少 LAN_TLS_KEY 或 LAN_TLS_CERT");
  process.exit(1);
}

function proxyRequest(request, response) {
  const upstream = http.request({
    hostname: "127.0.0.1",
    port: webPort,
    path: request.url,
    method: request.method,
    headers: { ...request.headers, host: request.headers.host },
  }, (upstreamResponse) => {
    response.writeHead(upstreamResponse.statusCode || 502, upstreamResponse.headers);
    upstreamResponse.pipe(response);
  });
  upstream.on("error", () => { response.writeHead(502); response.end("Mutiny Relay web service unavailable"); });
  request.pipe(upstream);
}

function proxyUpgrade(request, socket, head) {
  if (!request.url?.startsWith("/signal")) return socket.destroy();
  const upstream = net.connect(signalPort, "127.0.0.1", () => {
    const headers = Object.entries(request.headers).map(([name, value]) => `${name}: ${value}`).join("\r\n");
    upstream.write(`${request.method} ${request.url} HTTP/${request.httpVersion}\r\n${headers}\r\n\r\n`);
    if (head.length) upstream.write(head);
    socket.pipe(upstream).pipe(socket);
  });
  upstream.on("error", () => socket.destroy());
}

const server = https.createServer({ key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) }, proxyRequest);
server.on("upgrade", proxyUpgrade);

server.listen(port, host, () => console.log(`Mutiny Relay 局域网入口：https://${host}:${port}`));

if (publicHttpPort) {
  const publicServer = http.createServer(proxyRequest);
  publicServer.on("upgrade", proxyUpgrade);
  publicServer.listen(publicHttpPort, publicHttpHost, () => {
    console.log(`Mutiny Relay 隧道入口：http://${publicHttpHost}:${publicHttpPort}`);
  });
}
