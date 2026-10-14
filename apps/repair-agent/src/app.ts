import "./provider.ts";
export default {
  fetch() {
    return new Response("Not found", { status: 404 });
  },
};
