// Two independent Laravel sessions: private docs, sharing, autosave, presence and deletion.
import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
const base = process.env.LARAVEL_URL ?? 'http://localhost:3002';
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const errors = [];
const step = async (name, fn) => { process.stdout.write(`- ${name} ... `); await fn(); console.log('ok'); };
async function signUp(name) {
  const context = await browser.newContext();
  context.setDefaultTimeout(15_000);
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(base);
  const email = `${name}${Date.now()}@example.com`;
  await page.fill('#email', email);
  await page.fill('#password', 'password123');
  await page.click('#signup');
  await page.waitForSelector('#hello');
  await page.waitForFunction(() => document.querySelector('#realtime-status').textContent === 'Realtime connected');
  return { page, context, email };
}
async function api(page, path, method, body) {
  return page.evaluate(async ({ path, method, body }) => {
    const res = await fetch(path, {
      method,
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-CSRF-TOKEN': document.querySelector('meta[name="csrf-token"]').content },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() };
  }, { path, method, body });
}
try {
  const bob = await signUp('bob');
  const alice = await signUp('alice');
  let url, id;
  await step('Bob creates a private document; Alice cannot read it', async () => {
    await bob.page.fill('#new-doc-title', 'Laravel live demo');
    await bob.page.click('#create-doc');
    await bob.page.waitForSelector('#editor');
    url = bob.page.url(); id = url.split('/').pop();
    assert.equal(await alice.page.locator('.doc-link').count(), 0);
    const hidden = await alice.context.newPage();
    await hidden.goto(url); await hidden.waitForSelector('#not-found'); await hidden.close();
  });
  await step('missing-account sharing returns an actionable error', async () => {
    await bob.page.fill('#share-email', `missing${Date.now()}@example.com`);
    await bob.page.click('#share');
    await bob.page.waitForFunction(() => document.querySelector('#action-error').textContent.includes('sign up first'));
  });
  await step('sharing makes the document appear live for Alice', async () => {
    await bob.page.fill('#share-email', alice.email);
    await bob.page.click('#share');
    await alice.page.waitForSelector('.doc-link');
    await alice.page.click('.doc-link');
    await alice.page.waitForSelector('#editor');
    await alice.page.waitForFunction(() => document.querySelectorAll('#presence .avatar').length === 2);
    await bob.page.waitForFunction(() => document.querySelectorAll('#presence .avatar').length === 2);
    assert.equal(await alice.page.locator('#share').count(), 0);
    assert.equal(await alice.page.locator('#delete').count(), 0);
  });
  await step('typing broadcasts and edits autosave in both directions', async () => {
    await bob.page.fill('#content', 'Bob writes without clicking Save');
    await alice.page.waitForFunction(() => document.querySelector('#typing').textContent.includes('bob'));
    await alice.page.waitForFunction(() => document.querySelector('#content').value.includes('Bob writes'));
    await bob.page.waitForFunction(() => document.querySelector('#status').textContent === 'Saved');
    await alice.page.fill('#content', 'Alice edits the shared document');
    await bob.page.waitForFunction(() => document.querySelector('#content').value.includes('Alice edits'));
    await alice.page.waitForFunction(() => document.querySelector('#status').textContent === 'Saved');
    await alice.page.reload();
    assert.equal(await alice.page.inputValue('#content'), 'Alice edits the shared document');
  });
  await step('Alice cannot share or delete even through direct requests', async () => {
    assert.equal((await api(alice.page, `/docs/${id}/share`, 'POST', { email: bob.email })).status, 403);
    assert.equal((await api(alice.page, `/docs/${id}`, 'DELETE')).status, 404);
    const rows = await api(alice.page, '/docs', 'GET');
    assert.ok(rows.body.some((d) => d.id === id));
  });
  await step('writes require CSRF and token endpoints require a session', async () => {
    const missingCsrf = await alice.page.evaluate(async (id) => {
      const res = await fetch(`/docs/${id}`, {
        method: 'PATCH', headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'must not save' }),
      });
      return res.status;
    }, id);
    assert.equal(missingCsrf, 419);
    const signedOut = await browser.newContext();
    const response = await signedOut.request.get(`${base}/realtime-session`, { headers: { Accept: 'application/json' } });
    assert.equal(response.status(), 401);
    await signedOut.close();
  });
  await step('title changes update the list without refresh', async () => {
    const list = await alice.context.newPage(); await list.goto(base);
    await list.waitForFunction(() => document.querySelector('#realtime-status').textContent === 'Realtime connected');
    await bob.page.fill('#title', 'Renamed live');
    await list.waitForFunction(() => document.querySelector('.doc-link').textContent === 'Renamed live');
    await bob.page.waitForFunction(() => document.querySelector('#status').textContent === 'Saved');
    await list.close();
  });
  await step('Bob deletes; Alice sees her editor close live', async () => {
    bob.page.once('dialog', (dialog) => dialog.accept());
    await bob.page.click('#delete');
    await alice.page.waitForSelector('#deleted');
    assert.equal(await alice.page.locator('#editor').isVisible(), false);
  });
  assert.deepEqual(errors, []);
  console.log('PASS: Laravel collaboration');
} finally { await browser.close(); }
