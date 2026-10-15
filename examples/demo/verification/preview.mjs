import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { URL } from "node:url";

const assets = {
  "/": ["index.html", "text/html"],
  "/app.js": ["app.js", "text/javascript"],
  "/message.js": ["message.js", "text/javascript"],
};

createServer(async (request, response) => {
  try {
    const asset = Object.hasOwn(assets, request.url) ? assets[request.url] : undefined;
    if (asset) {
      response.setHeader("Content-Type", asset[1]);
      response.end(await readFile(new URL(`../dist/${asset[0]}`, import.meta.url)));
    } else {
      response.writeHead(404);
      response.end();
    }
  } catch {
    response.writeHead(500);
    response.end("Preview artifact unavailable");
  }
}).listen(18764, "127.0.0.1");
