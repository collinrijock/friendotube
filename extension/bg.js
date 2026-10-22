// All network calls go through here so the content script never needs CORS.
const DEFAULT_SERVER = "https://friendtube.collinrijock.com";

async function api(method, path, body) {
  const { server = DEFAULT_SERVER, token } = await chrome.storage.local.get(["server", "token"]);
  const res = await fetch(server.replace(/\/$/, "") + path, {
    method,
    headers: { "content-type": "application/json", ...(token && { authorization: `Bearer ${token}` }) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
  return res.ok ? data : { error: data.error ?? `HTTP ${res.status}`, status: res.status };
}

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg?.type !== "api") return;
  api(msg.method, msg.path, msg.body).then(reply, (err) => reply({ error: String(err.message ?? err) }));
  return true; // reply is async
});
