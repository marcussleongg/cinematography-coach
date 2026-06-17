# How HTTP Requests Work

## The Shape of a Request and Response

```
Request:   METHOD  PATH  HEADERS  [BODY]
Response:  STATUS  HEADERS  [BODY]
```

Every HTTP request has:

- **Method** — what action: `GET` (read), `POST` (create/send), `PUT`/`PATCH` (update), `DELETE`
- **Path** — the resource: `/api/renew`
- **Headers** — metadata: auth tokens, content type, etc.
- **Body** — optional data payload, used with `POST`/`PUT` (JSON, form data, etc.)

Every HTTP response has:

- **Status** — `2xx` success, `4xx` client error, `5xx` server error
- **Headers** — content type, caching, cookies, etc.
- **Body** — the actual data returned

---

## Examples

Two files, two opposite roles:

- `app.js` — runs in the **browser** (client). It _sends_ requests via `fetch`.
- `api/renew.js` — runs on the **server** (Vercel). It _receives_ requests via `handler(req, res)`.

### Client side — `fetch` in `app.js`

```js
const kr = await fetch("/api/renew", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ id: streamId }),
});
```

`fetch` is a browser built-in that sends an HTTP request and gives you back a `Response` object (`kr`).

```js
kr.ok; // true if status 200–299
kr.json(); // reads + parses the response body as JSON
```

### Server side — `handler` in `api/renew.js`

```js
export default async function handler(req, res) { ... }
```

Vercel's convention: any file in `api/` that exports a default function is automatically registered as an HTTP endpoint at that path. The name `handler` is just convention.

- **`req`** (request) — everything the client sent:
  - `req.method` → `"POST"`
  - `req.body` → `{ id: "stream_abc123" }` (parsed JSON)
  - `req.headers` → the headers from `fetch`

- **`res`** (response) — a writer you use to send back a reply:
  - `res.status(200).json({ renewed: true })` → sends HTTP 200 with JSON body
  - `res.status(400).json({ error: "id required" })` → sends HTTP 400

---

The server acts as a **proxy** — the browser can't call the Overshoot API directly (no API key, CORS restrictions), so it asks the server to do it on its behalf.
