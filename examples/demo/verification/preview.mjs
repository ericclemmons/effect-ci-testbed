import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { URL } from "node:url";

const artifact = new URL("../dist/message.js", import.meta.url);
const html = `<!doctype html><html><head><meta charset="utf-8"><title>Tiny Vite app</title></head><body>
<h1>Tiny Vite app</h1><p>Local preview of the actual build. Not a hosted deployment.</p>
<button id="show">Show message</button><p role="status" id="result" aria-live="polite"></p>
<script type="module">import {message} from '/message.js'; document.querySelector('#show').onclick=()=>{document.querySelector('#result').textContent=message;};</script>
</body></html>`;

createServer(async (request, response) => {
  try {
    if (request.url === "/message.js") {
      response.setHeader("Content-Type", "text/javascript");
      response.end(await readFile(artifact));
    } else if (request.url === "/") {
      response.setHeader("Content-Type", "text/html");
      response.end(html);
    } else {
      response.writeHead(404);
      response.end();
    }
  } catch {
    response.writeHead(500);
    response.end("Preview artifact unavailable");
  }
}).listen(18764, "127.0.0.1");
