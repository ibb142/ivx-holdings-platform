// IVX credential bridge — cleaned up. No credential-exposing endpoints remain.
export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/ping") {
      return Response.json({ ok: true, now: new Date().toISOString() });
    }
    return Response.json({ ok: true });
  },
};
