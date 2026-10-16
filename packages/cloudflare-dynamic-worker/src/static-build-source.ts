/** Fixed compiler tooling, never concatenate project source into the host bundle. */
export const staticBuildToolSource = String.raw`
import { transform } from "sucrase";
export default { async fetch(request, env) {
  const source = await request.text();
  if (Object.keys(env).length || new TextEncoder().encode(source).length > 32768 || source.includes("\0"))
    return new Response("Invalid build source", {status: 422});
  try {
    const code = transform(source, {transforms: ["typescript"], production: true, disableESTransforms: true}).code;
    if (new TextEncoder().encode(code).length > 32768 || code.includes("\0"))
      return new Response("Build output exceeds limit", {status: 422});
    return Response.json({code});
  } catch { return new Response("TypeScript transform failed", {status: 422}); }
}};
`
