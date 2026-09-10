import { Router } from 'express';
import { uploadMemory } from '../lib/upload';
import { parseDstTransferTaxUpload } from '../parsers/dstTransferTaxParser';
import { computeDstTransferTaxRows } from '../services/dstTransferTaxCompute';
import { generateDstTransferTaxComputation, generateDstTransferTaxTemplate } from '../generators/dstTransferTaxGenerator';

export const dstTransferTaxRouter = Router();

// GET /api/dst-transfer-tax/template.xlsx — blank template with the 7 columns
// a tax reviewer fills in (Contract Number, Tower, Unit/Storage Area,
// Parking Area, CTS Notary Date, TCP net of VAT, FMV per Tax Declaration).
dstTransferTaxRouter.get('/template.xlsx', async (_req, res) => {
  const buffer = await generateDstTransferTaxTemplate();
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="DST and Transfer Tax Template.xlsx"');
  res.send(buffer);
});

// POST /api/dst-transfer-tax/compute — upload a filled-in template, trace
// RDO/Tagging/ZV-per-sqm from the Zonal Value reference (as of each row's
// CTS Notary Date), compute the Total ZV columns, and return a new workbook
// with all of it filled in (computed columns carry real Excel formulas).
dstTransferTaxRouter.post('/compute', uploadMemory.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  const inputs = await parseDstTransferTaxUpload(req.file.buffer);
  if (inputs.length === 0) {
    return res.status(400).json({ error: 'No rows found — check that "Contract Number" has a value in each row' });
  }

  const computed = computeDstTransferTaxRows(inputs);
  const buffer = await generateDstTransferTaxComputation(computed);

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="DST and Transfer Tax Computation.xlsx"');
  res.send(buffer);
});
