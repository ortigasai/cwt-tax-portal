import { Router } from 'express';
import { clearDoasSession, doasConnectionStatus, setDoasSession } from '../services/doasAuth';

export const doasRouter = Router();

// GET /api/doas/status — does DOAS accept the portal right now?
doasRouter.get('/status', async (_req, res) => {
  res.json(await doasConnectionStatus());
});

// PUT /api/doas/session { session } — save the DOAS session (a Cookie header
// value or a service token) the portal sends with its DOAS requests, then test it.
doasRouter.put('/session', async (req, res) => {
  const value = String((req.body as { session?: unknown }).session ?? '').trim();
  if (!value) return res.status(400).json({ error: 'Paste the DOAS session first.' });
  setDoasSession(value);
  res.json(await doasConnectionStatus());
});

// DELETE /api/doas/session — forget it.
doasRouter.delete('/session', async (_req, res) => {
  clearDoasSession();
  res.json(await doasConnectionStatus());
});
