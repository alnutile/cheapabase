# cheapabase + Laravel

**Auth, Postgres data, and live collaboration in Laravel 12 + Blade.**

Sign up, create a private document, share it with another account, and watch edits arrive
in another browser session. This example uses cheapabase as its backend: no Echo, Reverb,
Pusher credentials, queue worker, npm, or Vite build is needed for this flow.

Laravel handles routes, sessions, CSRF protection, and HTTP calls. cheapabase runs Auth,
PostgREST, and the WebSocket server. The browser subscribes with the included `realtime.js`
client. This demonstrates database events and cheapabase channels; it doesn't implement
Laravel's broadcasting API or the Pusher protocol.

What it shows:

- **Auth**: sign up and sign in through cheapabase's GoTrue (`/auth/v1`). Tokens live in the normal Laravel session, and the access token is refreshed with the refresh token when it expires.
- **Data with RLS**: list, create and save docs through PostgREST (`/rest/v1`) with the user's own JWT. The app never holds the service key, so Postgres row level security decides what each user can see.
- **Functions**: the home page shows the result of `GET /functions/v1/hello`.
- **Realtime**: shared documents appear in the list without refreshing; titles and saved edits update live.
- **Collaboration**: autosave, presence avatars, typing indicators, owner-only sharing and deletion, and live deletion in other viewers.
- **Token refresh**: Laravel keeps the refresh token in its session. The browser periodically obtains a short-lived access token from a same-origin endpoint and updates its WebSocket authentication.

All of the HTTP calls go through one small class, [`app/Services/Cheapabase.php`](app/Services/Cheapabase.php), which uses Laravel's `Http` facade. Laravel needs no database of its own here (sessions and cache are file based), and there's no npm or Vite step: just Blade with an inline `<style>`.

## Prerequisites

- PHP 8.2+ (tested with 8.3) and Composer
- cheapabase running with the docs migration, e.g. `docker compose up` from the repo root (http://localhost:8000)

## Install and run

```bash
cd examples/laravel
composer install
cp .env.example .env && php artisan key:generate
PHP_CLI_SERVER_WORKERS=4 php artisan serve --no-reload --host=127.0.0.1 --port=3002
```

Open http://localhost:3002. Run the browser smoke test from the repo root:

```bash
node examples/smoke.mjs http://localhost:3002
node test/ui/laravel-collaboration.mjs
```

For CI or scripts, the same steps non-interactively:

```bash
composer install --no-interaction --no-progress
cp .env.example .env && php artisan key:generate --no-interaction
PHP_CLI_SERVER_WORKERS=4 php artisan serve --no-reload --host=127.0.0.1 --port=3002
```

## Bob and Alice demo

1. Open **http://localhost:3002** in Chrome and an Incognito window.
2. Sign up as Bob in Chrome. Enter a title and click **Create**. Type into the document;
   it saves automatically. Wait for **Saved**.
3. Sign up as Alice in Incognito. Bob's private document does not appear in her list.
4. In Bob's editor, enter Alice's email under **Share with an existing account** and click **Share**.
   The document appears in Alice's list live. Alice must sign up before sharing.
5. Open the document as Alice. Both users appear as avatars. Type as Bob and watch Alice's
   typing indicator and document update. Pause, then edit as Alice and watch Bob's window.
6. Change the title or refresh a window to show live updates and persistence.
7. Delete as Bob. Alice's editor closes live. Alice can edit, but cannot share or delete.

Use fresh email addresses for each rehearsal or sign in to existing accounts. Take turns
typing: this example saves whole documents with **last-write-wins**, not a CRDT editor.
If an editor has unsaved text, incoming updates do not overwrite that local text.

The demo uses the same cheapabase backend as the vanilla app on port 8000, so accounts
and documents work across both frontends. The Laravel frontend itself is on port 3002.

## Environment

| Variable | Default | Meaning |
|---|---|---|
| `CHEAPABASE_URL` | `http://localhost:8000` | Where the cheapabase gateway is. The anon key is fetched from `$CHEAPABASE_URL/config.json` and cached for an hour. |
| `PHP_CLI_SERVER_WORKERS` | `4` | Lets `php artisan serve` handle requests in parallel. |
| `SESSION_DRIVER`, `CACHE_STORE` | `file` | No database needed. |

The browser also talks to `CHEAPABASE_URL` directly for realtime, so it has to be reachable from the browser, not just from PHP.

## Where things are

| File | What it does |
|---|---|
| `app/Services/Cheapabase.php` | Anon key, sign up/in/out, token refresh, `rest()` and `function()` calls as the user |
| `app/Http/Controllers/AuthController.php` | `POST /signup`, `/signin`, `/signout` |
| `app/Http/Controllers/DocController.php` | Lists, creates, edits, shares and deletes docs; supplies refreshed access tokens |
| `app/Http/Middleware/SignedIn.php` | Sends signed-out visitors back to `/` |
| `resources/views/` | Blade templates with server-rendered content and collaboration controls |
| `public/collaboration.js` | Autosave through Laravel; realtime row subscriptions, presence and typing through cheapabase |

For hosting, configure Laravel as you would any PHP app, with persistent session storage,
`APP_DEBUG=false`, and an application key. Set `CHEAPABASE_URL` to a public HTTPS endpoint
reachable from both PHP and the browser. Laravel's development server is for local demos.
