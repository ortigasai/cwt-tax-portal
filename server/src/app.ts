import cors from 'cors';
import express from 'express';
import cookieParser from 'cookie-parser';
import { contractsRouter } from './routes/contracts';
import { referenceRouter } from './routes/reference';
import { zonalValuesRouter } from './routes/zonalValues';
import { syncRouter } from './routes/sync';
import { authRouter } from './routes/auth';
import { dstTransferTaxRouter } from './routes/dstTransferTax';
import { requireAuth } from './middleware/requireAuth';

export function createApp(): express.Express {
  const app = express();

  // Reflects whatever origin made the request (rather than a single fixed
  // CLIENT_URL) since the portal is now reachable from several hostnames on
  // the LAN (localhost, 127.0.0.1, this machine's LAN IP). credentials:true
  // is required so the session cookie is sent on cross-origin requests
  // (client:5173 -> api:4100 are different origins even on the same host).
  app.use(cors({ origin: (_origin, callback) => callback(null, true), credentials: true }));
  app.use(express.json());
  app.use(cookieParser());

  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  app.use('/api/auth', authRouter);
  app.use('/api', requireAuth);
  app.use('/api/contracts', contractsRouter);
  app.use('/api/reference', referenceRouter);
  app.use('/api/zonal-values', zonalValuesRouter);
  app.use('/api/sync', syncRouter);
  app.use('/api/dst-transfer-tax', dstTransferTaxRouter);

  app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error(err);
    res.status(500).json({ error: err.message ?? 'Internal server error' });
  });

  return app;
}
