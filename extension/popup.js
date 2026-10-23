// Rendering mirrors formal/FriendoTube/Render.lean (popup, groupRow; theorem popup_safe):
// server data only reaches textContent, confirm() text and the clipboard.
const DEFAULT_SERVER = "https://friendotube.collinrijock.com";
const $ = (id) => document.getElementById(id);
const api = (method, path, body) => chrome.runtime.sendMessage({ type: "api", method, path, body });
const store = chrome.storage.local;

function showError(r) {
  $("err").textContent = r?.error ?? "";
  return !r?.error;
}

// Lean: groupRow, one per group.
function renderGroups(groups) {
  $("groups").replaceChildren(...(groups.length ? groups.map((g) => {
    const div = document.createElement("div");
    div.className = "group";
    const name = document.createElement("b");
    name.textContent = g.name;
    const code = document.createElement("span");
    code.className = "code";
    code.textContent = g.code;
    code.title = "Click to copy; send this to friends so they can join";
    code.onclick = () => navigator.clipboard.writeText(g.code).then(() => (code.textContent = "copied!"), () => {}).then(() => setTimeout(() => (code.textContent = g.code), 1000));
    const leave = document.createElement("button");
    leave.className = "link";
    leave.textContent = "leave";
    leave.onclick = async () => { if (confirm(`Leave ${g.name}?`)) { const r = await api("POST", "/api/groups/leave", { groupId: g.id }); if (showError(r)) renderGroups(r.groups); } };
    const members = document.createElement("div");
    members.className = "muted";
    members.textContent = g.members.join(", ");
    const line = document.createElement("div");
    line.append("Invite code ", code, " · ", leave);
    div.append(name, line, members);
    return div;
  }) : [Object.assign(document.createElement("p"), { className: "muted", textContent: "No groups yet. Create one or join with a friend's code." })]));
}

async function refresh() {
  const { server = DEFAULT_SERVER, token, shareFeed } = await store.get(["server", "token", "shareFeed"]);
  $("server").value = server;
  $("shareFeed").checked = shareFeed !== false;
  $("signedOut").hidden = !!token;
  $("signedIn").hidden = !token;
  if (!token) return;
  const r = await api("GET", "/api/me");
  if (r?.status === 401) { await store.remove("token"); return refresh(); }
  if (!showError(r)) return;
  $("me").textContent = r.user.name;
  renderGroups(r.groups);
}

$("signup").onsubmit = async (e) => {
  e.preventDefault();
  const r = await api("POST", "/api/signup", { name: $("name").value });
  if (showError(r)) { await store.set({ token: r.token }); refresh(); }
};
$("join").onsubmit = async (e) => {
  e.preventDefault();
  const r = await api("POST", "/api/groups/join", { code: $("code").value });
  if (showError(r)) { $("code").value = ""; renderGroups(r.groups); }
};
$("create").onsubmit = async (e) => {
  e.preventDefault();
  const r = await api("POST", "/api/groups", { name: $("groupName").value });
  if (showError(r)) { $("groupName").value = ""; renderGroups(r.groups); }
};
$("shareFeed").onchange = () => store.set({ shareFeed: $("shareFeed").checked });
$("serverForm").onsubmit = async (e) => { e.preventDefault(); await store.set({ server: $("server").value }); refresh(); };
$("signOut").onclick = async () => {
  if (!confirm("Sign out? There is no password: this browser's key is the only way back into this account.")) return;
  await store.remove("token");
  refresh();
};
$("forget").onclick = async () => {
  if (!confirm("Delete your account, your feed history and your recommendations?")) return;
  if (showError(await api("POST", "/api/forget-me"))) { await store.remove("token"); refresh(); }
};

refresh();
