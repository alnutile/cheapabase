// Laravel owns sessions and writes; the browser connects to cheapabase for realtime.
const config = JSON.parse(document.getElementById('collaboration-config').textContent);
const $ = (id) => document.getElementById(id);
const csrf = document.querySelector('meta[name="csrf-token"]').content;
let rt, room, token;
let stopped = false;

async function request(path, method = 'GET', body) {
  const response = await fetch(path, {
    method,
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-CSRF-TOKEN': csrf },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? data.message ?? 'Request failed');
  return data;
}
async function refreshToken() {
  token = (await request('/realtime-session')).accessToken;
  return token;
}
function error(e) { ($('action-error') ?? $('realtime-status')).textContent = e.message; }

async function loadDocs() {
  const docs = await request('/docs');
  $('doc-list').replaceChildren(...docs.map((doc) => {
    const li = document.createElement('li');
    const link = document.createElement('a');
    link.className = 'doc-link';
    link.href = `/docs/${doc.id}`;
    link.textContent = doc.title;
    li.append(link);
    if (doc.owner_id !== config.user.id) {
      const tag = document.createElement('span');
      tag.className = 'tag';
      tag.textContent = 'shared';
      li.append(tag);
    }
    return li;
  }));
  if (!docs.length) $('doc-list').textContent = 'No docs yet.';
}

let dirty = false, saving = false, sequence = 0;
let timer, typingTimer;
let lastTyping = 0;
function removed() {
  if (stopped) return;
  stopped = true;
  dirty = false;
  clearTimeout(timer);
  rt?.close();
  $('editor').hidden = true;
  if ($('share-form')) $('share-form').hidden = true;
  if ($('delete')) $('delete').hidden = true;
  $('presence').replaceChildren();
  $('typing').textContent = '';
  $('status').textContent = 'Deleted';
  $('doc-title').textContent = 'Document deleted';
  const message = document.createElement('p');
  message.id = 'deleted';
  message.textContent = 'The owner deleted this document.';
  $('editor').after(message);
}
function scheduleSave(delay = 150) {
  if (timer || saving || stopped) return;
  timer = setTimeout(() => { timer = null; save(); }, delay);
}
async function save() {
  if (saving || stopped || !dirty) return;
  saving = true;
  const sent = sequence;
  let retryDelay = 150;
  try {
    await request(`/docs/${config.doc.id}`, 'PATCH', { title: $('title').value, content: $('content').value });
    if (sent === sequence) dirty = false;
    if (stopped) return;
    $('doc-title').textContent = $('title').value;
    $('status').textContent = dirty ? 'Saving...' : 'Saved';
  } catch (e) {
    if (stopped) return;
    $('status').textContent = `Save failed: ${e.message}`;
    // Keep unsaved text and back off instead of flooding a failed backend.
    retryDelay = 3000;
  } finally {
    saving = false;
    if (dirty) scheduleSave(retryDelay);
  }
}
if (config.doc) {
  for (const id of ['title', 'content']) $(id).addEventListener('input', () => {
    dirty = true;
    sequence++;
    $('status').textContent = 'Saving...';
    scheduleSave();
    if (Date.now() - lastTyping > 1000) {
      lastTyping = Date.now();
      room?.send('typing', {});
    }
  });
  $('editor').addEventListener('submit', (event) => {
    event.preventDefault();
    dirty = true;
    clearTimeout(timer);
    timer = null;
    save();
  });
  $('share-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    $('action-error').textContent = '';
    try {
      const member = await request(`/docs/${config.doc.id}/share`, 'POST', { email: $('share-email').value });
      const emails = new Set(config.members.map((m) => m.email));
      emails.add(member.email);
      config.members = [...emails].map((email) => ({ email }));
      $('members').textContent = `Shared with ${[...emails].join(', ')}`;
      $('share-email').value = '';
    } catch (e) { error(e); }
  });
  $('delete')?.addEventListener('click', async () => {
    if (!confirm('Delete this document for everyone?')) return;
    try { await request(`/docs/${config.doc.id}`, 'DELETE'); removed(); }
    catch (e) { error(e); }
  });
  window.addEventListener('beforeunload', (event) => {
    if (dirty) { event.preventDefault(); event.returnValue = ''; }
  });
}
try {
  const { RealtimeClient } = await import(`${config.url}/realtime.js`);
  await refreshToken();
  rt = new RealtimeClient(config.url, () => token);
  if ($('doc-list')) {
    const reload = () => loadDocs().catch(error);
    await rt.on('docs', {}, reload);
    await rt.on('doc_members', { filter: `user_id=eq.${config.user.id}` }, reload);
    await loadDocs();
  } else {
    await rt.on('docs', { filter: `id=eq.${config.doc.id}` }, (change) => {
      if (change.event === 'DELETE') { removed(); return; }
      if (dirty || saving) return;
      $('title').value = change.new.title;
      $('doc-title').textContent = change.new.title;
      $('content').value = change.new.content;
      $('status').textContent = change.new.updated_by === config.user.id ? 'Saved' : 'Updated elsewhere';
    });
    room = rt.channel(`doc:${config.doc.id}`, { presence: { email: config.user.email } });
    room.onPresence((users) => {
      const unique = new Map(users.map((user) => [user.user_id, user]));
      $('presence').replaceChildren(...[...unique.values()].map((user) => {
        const avatar = document.createElement('span');
        avatar.className = 'avatar';
        avatar.title = user.email;
        avatar.textContent = user.email.slice(0, 2).toUpperCase();
        return avatar;
      }));
    });
    room.on('typing', (_payload, from) => {
      $('typing').textContent = `${from.email} is typing...`;
      clearTimeout(typingTimer);
      typingTimer = setTimeout(() => { $('typing').textContent = ''; }, 2000);
    });
    await room.join();
  }
  $('realtime-status').textContent = 'Realtime connected';
} catch (e) { error(e); }
// PHP retains the refresh token; update websocket auth before the access token expires.
const refreshTimer = setInterval(async () => {
  if (stopped || !rt) return;
  try { rt.setAuth(await refreshToken()); }
  catch (e) { rt.close(); error(e); }
}, 20_000);
window.addEventListener('pagehide', () => { clearInterval(refreshTimer); rt?.close(); });
