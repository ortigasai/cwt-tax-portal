import { Router } from 'express';
import { syncFromFolder, getLastSync, getDataDir } from '../services/folderSync';
import { updateFromSharePoint } from '../services/sharepointSync';

export const syncRouter = Router();

// GET /api/sync/status — last sync result + the folder being watched.
syncRouter.get('/status', (_req, res) => {
  res.json({ dataDir: getDataDir(), last: getLastSync() });
});

// POST /api/sync — trigger an immediate sync. ?force=1 reloads every file even
// if unchanged.
syncRouter.post('/', async (req, res) => {
  const force = req.query.force === '1' || req.query.force === 'true';
  const summary = await syncFromFolder({ force });
  res.json(summary);
});

// POST /api/sync/from-sharepoint — pull the OCLP 1606 Summary and Zonal
// Value files directly from SharePoint (via the IT-issued API — see
// sharepointApi.ts/sharepointSync.ts), then run the normal folder sync.
// Replaces the manual "download via browser, drop in the folder" workflow.
syncRouter.post('/from-sharepoint', async (_req, res) => {
  try {
    const summary = await updateFromSharePoint();
    res.json(summary);
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
});
