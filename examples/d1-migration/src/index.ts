interface Env {
  readonly DATABASE: D1Database
}

export default {
  async fetch(_request, env) {
    const result = await env.DATABASE.prepare(
      "SELECT COUNT(*) AS count, COUNT(display_name) AS named FROM users",
    ).first<{ count: number; named: number }>()

    return Response.json({ users: result?.count ?? 0, namedUsers: result?.named ?? 0 })
  },
} satisfies ExportedHandler<Env>
