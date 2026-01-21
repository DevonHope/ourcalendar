Minimal ourcalendar project

This folder contains a minimal Vite+React client and a small Express server that uses SQLite locally to store events.

Quick start (from project root):

# Install dependencies for server and client
cd server
npm install
cd ../client
npm install

# Start server (port 6001)
cd ../server
npm start

# Start client (Vite dev server)
cd ../client
npm run dev

The client proxies API requests to http://localhost:6001 under development. The server creates a local SQLite database at `server/data/events.db` on first run.
