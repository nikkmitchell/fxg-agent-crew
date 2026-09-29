#!/usr/bin/env node
/**
 * A LOCAL BRIDGE SO ORDINARY GIT REACHES saha.ing (Nikk, 6310: "every agent
 * should be able to use the saha.ing git system").
 *
 * Something on the route into the saha.ing box resets TLS connections that
 * name saha.ing from curl-based clients: git, curl, Python, on macOS and
 * Windows alike. Node's own TLS gets through (Sill, 6307). So this listens on
 * 127.0.0.1 only and forwards git's requests to https://saha.ing with Node's
 * fetch, which checks the certificate as usual. Nothing is turned off: the
 * only unencrypted hop is inside your own machine.
 *
 *   node tools/saha-git-bridge.mjs            # listens on 127.0.0.1:18480
 *   git clone http://127.0.0.1:18480/git/<space>.git
 *
 * Or keep your usual https://saha.ing remote and send it through the bridge:
 *
 *   git config --global url."http://127.0.0.1:18480/git/".insteadOf https://saha.ing/git/
 *
 * Log in as always (your WebHarness name, and your token as the password, or
 * tools/webharness/git-credential-saha.py configured for http://127.0.0.1:18480).
 * No packages needed: Node 18 or later.
 */
import http from "node:http";
import { Readable } from "node:stream";

const PORT = Number(process.env.SAHA_BRIDGE_PORT ?? 18480);
const TARGET = (process.env.SAHA_BRIDGE_TARGET ?? "https://saha.ing").replace(/\/$/, "");
/** Only git's own requests go through, nothing else on saha.ing. */
const ALLOWED = /^\/git\/[A-Za-z0-9._-]+\.git\/(info\/refs|git-upload-pack|git-receive-pack)(\?|$)/;
/** Headers git sends that the server needs; everything else (Host, Connection) is Node's to set. */
const FORWARD = ["authorization", "content-type", "content-encoding", "accept", "accept-encoding", "git-protocol", "user-agent"];
const HOP = new Set(["connection", "keep-alive", "transfer-encoding", "content-length"]);

const server = http.createServer(async (request, response) => {
  if (!ALLOWED.test(request.url ?? "")) {
    response.writeHead(404, { "content-type": "text/plain" }).end("saha-git-bridge: only /git/<space>.git is forwarded.\n");
    return;
  }
  const headers = {};
  for (const name of FORWARD) if (request.headers[name]) headers[name] = request.headers[name];
  const hasBody = request.method !== "GET" && request.method !== "HEAD";
  try {
    const answer = await fetch(`${TARGET}${request.url}`, {
      method: request.method,
      headers,
      body: hasBody ? Readable.toWeb(request) : undefined,
      duplex: hasBody ? "half" : undefined,
      redirect: "manual",
    });
    const back = {};
    answer.headers.forEach((value, name) => {
      if (!HOP.has(name)) back[name] = value;
    });
    // fetch has already undone any content-encoding, so say nothing about one.
    delete back["content-encoding"];
    response.writeHead(answer.status, back);
    if (answer.body) Readable.fromWeb(answer.body).pipe(response);
    else response.end();
  } catch (error) {
    const reason = error?.cause?.code ?? error?.message ?? String(error);
    console.error(`saha-git-bridge: ${request.method} ${request.url}: ${reason}`);
    if (!response.headersSent) response.writeHead(502, { "content-type": "text/plain" });
    response.end(`saha-git-bridge could not reach ${TARGET}: ${reason}\n`);
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`saha-git-bridge: http://127.0.0.1:${PORT}/git/<space>.git -> ${TARGET}/git/<space>.git`);
});
