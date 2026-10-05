interface Env {
  readonly DATABASE: D1Database
}

export default {
  async fetch(_request, env) {
    const result = await env.DATABASE.prepare(
      "SELECT COUNT(*) AS count FROM users",
    ).first<{ count: number }>()

    return Response.json({ users: result?.count ?? 0 })
  },
} satisfies ExportedHandler<Env>
