# Server notes

Run `npm install` then `npm run init-db` to initialize the SQLite DB, then `npm start` to run the server on port 5913.

Security: field encryption and password hashing

This server now uses Argon2 for password hashing and AES-256-GCM for field-level encryption. Before starting the server you MUST provide an encryption key via environment variable `OURCALENDAR_ENC_KEY` (base64-encoded 32 bytes). Example:

```
# generate a key and export it (one-liner)
export OURCALENDAR_ENC_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('base64'))")
```

When the server starts it will perform a migration that:
- creates a timestamped backup of the DB
- hashes any plaintext passwords (Argon2)
- encrypts configured sensitive fields (users.name, users.photo, users.birthday, events.title, events.description)

If you do not set `OURCALENDAR_ENC_KEY` the server will refuse to start; this is intentional to avoid accidentally encrypting the DB with an ephemeral key. To generate a key, run the small helper `node generate-key.js`.

The server exposes:
- GET /api/events  — list events (returned values are decrypted by the server)
- POST /api/events {title,start,end,description} — create event (server encrypts sensitive fields)
- DELETE /api/events/:id — delete

The client Vite dev server proxies `/api` to `http://localhost:5913`.

Embedding notes
----------------
If you plan to embed the client inside a native app webview or an iframe, ensure the server allows framing. By default some hosting platforms add `X-Frame-Options: DENY` or a Content-Security-Policy that prevents embedding.

In Express you can allow framing from any origin (or restrict to your app) by adding a header like:

```js
app.use((req, res, next) => {
	res.setHeader('X-Frame-Options', 'ALLOWALL') // or 'ALLOW-FROM https://your.app'
	next()
})
```

For production, prefer configuring a strict Content-Security-Policy instead of ALLOWALL. Example CSP header allowing framing from your app domain:

```js
res.setHeader('Content-Security-Policy', "frame-ancestors 'self' https://your.mobile.appdomain.com")
```

Also ensure mobile webviews include a viewport meta tag (the client `index.html` already sets `width=device-width,initial-scale=1`).
