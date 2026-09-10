import 'dotenv/config';
import { createApp } from './app';
import { ensureUploadsDir } from './lib/fileStorage';
import { getDataDir } from './services/folderSync';

ensureUploadsDir();

const app = createApp();
const port = Number(process.env.PORT ?? 4100);

const server = app.listen(port, () => {
  console.log(`CWT Tax Exposure Portal API listening on http://localhost:${port}`);
  console.log(`[folder-sync] watching (on demand only — no background loop): ${getDataDir()}`);
});

server.on('error', (err) => {
  console.error('Server failed to start:', err);
  process.exit(1);
});

// Shutdown handler so tsx-watch restarts (and normal exits) release port 4100
// immediately — exiting the process frees the listening socket at once
// (listening sockets have no TIME_WAIT), rather than waiting on
// server.close() to drain keep-alive connections.
function shutdown(): void {
  server.close();
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
