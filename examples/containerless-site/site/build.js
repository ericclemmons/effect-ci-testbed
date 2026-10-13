import { escape } from "./escape.js";
export default {
  async fetch(request) {
    const files = await request.json();
    const content = JSON.parse(files["content.json"]);
    return Response.json({
      "index.html": `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(content.title)}</title><link rel="stylesheet" href="./style.css"><script src="./client.js" defer></script></head><body><main><p class="eyebrow">Built and served by Dynamic Workers</p><h1>${escape(content.title)}</h1><p>${escape(content.description)}</p><button id="counter" type="button">Count: 0</button><p class="note">Pinned GitHub source → isolated build → immutable site. No containers.</p></main></body></html>`,
      "style.css": files["style.css"],
      "client.js": files["client.js"],
    });
  },
};
