// No credential, service binding, project code or public write API in the bootstrap.
export default { fetch: () => new Response("No static revision published", { status: 404 }) };
