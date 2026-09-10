# CWT Tax Exposure Portal

Computes and reports Creditable Withholding Tax (CWT) exposure for real property title transfer transactions, per the `CWT_Tax_Exposure_Portal_FS_v1.1.docx` functional spec. Upload a list of contract numbers, enrich each with source data, and the portal computes the applicable CWT deadline, tax due, and penalties — then generates a BIR-format Tax Payment Ledger Excel file.

## Stack

- **Backend**: Node.js + TypeScript + Express + Prisma + PostgreSQL
- **Frontend**: React + TypeScript + Vite
- **Excel**: `exceljs` for both parsing uploads and generating the ledger export

## Setup

Requires Node.js >=20 and a local PostgreSQL server.

```bash
createdb cwt_tax_portal

cd server
cp .env.example .env   # edit DATABASE_URL if needed
npm install
npm run db:migrate      # applies migrations + generates the Prisma client

cd ../client
npm install

cd ..
npm install              # root — installs `concurrently` for the dev script
npm run dev               # starts server (:4100) and client (:5173)
```

Open http://localhost:5173.

## Workflow

1. **Upload Contracts** — upload an Excel file with a column of contract numbers. Creates a stub record per contract.
2. **Reference Data** — bulk-upload the `OCLP – 1606 Summary` workbook (parses the `FINAL` tab: buyer classification, tax tagging, transaction/paid dates, actual CWT remitted) and `RPT_ALL TOWERS.xlsx` (Fair Market Value reference table). Re-uploading either replaces the relevant data.
3. **Contract detail page** — per contract:
   - Upload the contract's `Customer_Ledger_<contractNumber>.xlsx` export — this populates buyer name, tower/unit, Net TCP, and the full payment schedule (drives Sheet 1 of the export).
   - Search and match the contract's Tower/Unit against the RPT_ALL TOWERS FMV table.
   - Manually enter CTS Notary Date, SQM (unit + parking), and Zonal Value per SQM — see **Known limitations** below.
4. **Dashboard** — summary table with computed CWT base/due, penalties, and status per contract.
5. **Download** — each contract's detail page has a button to download a 2-sheet Tax Payment Ledger Excel file:
   - **Sheet 1** mirrors `Tax Payment Ledger Template.xlsx` exactly (header block + the same 6-column payment table) — no computation columns.
   - **Sheet 2 ("Duplicate")** repeats the same payment rows side by side with per-line CWT columns (applicable deadline, should-be CWT due — net of VAT) plus the actual CWT file (OCLP 1606 Summary) line items — Transaction Date, Date Paid, CWT Tax Base, CWT Tax Due — matched to each ledger row by payment month/year, plus a summary block (buyer classification, tax tagging, CTS Notary Date, suggested RDO, zonal value, tax base/due, penalties). A totals row and tie-out line confirm the CWT File Tax Due column sums to the CWT file's actual remitted total. Each line is a standalone snapshot, not a running/cumulative total — overall compliance is judged at the contract level in the summary block, since remittances aren't reliably attributable to one specific collection.
   - The same per-payment breakdown is also shown on the contract detail page in-app, not just in the download.

## Zonal value RDO reference

The tax team's own tower → Revenue District Office mapping (Pasig City RDO 43, Quezon City RDO 40, Calatagan Batangas RDO 58, San Juan RDO 42) is in `server/src/lib/rdoLocations.ts` and surfaced on the Reference Data page and the contract detail page's Zonal Value field, to point users at the right RDO to check on bir.gov.ph. It's a static reference list, not live data — see the BIR limitation below.

## Known limitations / manual-entry fallbacks

These were deliberate scope decisions, not oversights — each has a real technical reason documented in code comments:

- **BIR Zonal Values have no automated lookup.** `bir.gov.ph/zonal-values` has no public API, no date/location query parameters, and — as verified while building this — every one of its 19 revenue-region tabs currently contains only unpublished CMS placeholder content. The Reference Data page fetches the live region name list as a browsing aid, but the per-contract Zonal Value per SQM must be entered manually after checking the BIR site directly. See `server/src/services/birZonalValues.ts`.
- **CTS Notary Date and SQM are manual entry.** CTS PDFs in the sample data are scanned images with zero extractable text (verified with `pdf-parse`) — there's no reliable way to auto-read the notary date or SQM. Upload the PDF for reference/attachment; enter the values manually on the contract detail page.
- **AR Sale has no deadline rule.** FS Section 6.1 defines deadlines for Individual+Installment, ETB/Corporation+Installment, and Cash Deferred, but not AR Sale (Section 6.2 only gives its tax computation rule). The computation engine returns no deadline for AR Sale contracts unless a manual override is supplied — confirm the correct rule with the tax/legal team.
- **Penalty base uses the exposure (variance) amount, not the full CWT due.** FS Sections 6.3 and 6.4 give conflicting language here ("25% of CWT Tax Due" vs. "penalties applied on the exposure amount"). We apply penalties to the variance, since 6.4 is the more specific rule for partial-remittance cases and avoids double-penalizing tax that was already remitted on time. Confirm this interpretation with the tax/legal team — see the comment block at the top of `server/src/services/computation.ts`.
- **ETB/Corporation + Installment aging** uses FIFO (first unmet deadline) to anchor the "days late" interest calculation when there are many per-collection deadlines. This is a reasonable interpretation, not something the FS specifies explicitly.
- **A ₱1.00 rounding tolerance** is applied before flagging a contract as under-remitted, since summing many per-collection remittances accumulates centavo-level floating-point noise that would otherwise trigger the ₱1,000 minimum compromise penalty on a one-centavo "shortfall."
- **Per-row CWT is strictly that row's own principal × 5% — no reconciliation shortfall is applied anywhere.** FS 6.2's "Important" note says the total must equal Base × 5%, but per the tax team's explicit direction, per-row amounts are never adjusted to force that reconciliation (confirmed after an earlier version trued up a shortfall onto the final payment, which was rejected). The sum of per-row amounts can therefore differ slightly from the contract's overall CWT due shown in the summary — that overall figure is computed independently from Net TCP/FMV/Zonal, not by summing collections.
- **Per-payment lines are standalone snapshots, not running totals.** Each row shows only that payment's own should-be CWT due — there's no cumulative tracking or per-line compliance verdict, since remittances aren't reliably attributable to one specific collection. Overall compliance (`status`/`variance`) is judged once, at the contract level, from total due vs. total remitted.
- **Entries are matched back to their originating payment row by array position/reference, never by date value.** Real data has multiple payments sharing the same date (verified on contract 2000000002661) — date-keyed matching let one row's entry silently overwrite another's. See `etbInstallmentObligationRows`, `individualInstallmentTriggerRow`, and `cashDeferredTriggerRow` in `server/src/services/computation.ts`.
- **Total Collection is derived from Principal + VAT when blank in the source ledger.** Verified on real data: a multi-million-peso row had Payment Principal and VAT populated but a blank Total Collection cell, which silently excluded it from CWT entirely. See `customerLedgerParser.ts`.
- **CWT is computed on the VAT-exclusive principal, and reservation fees are folded into the 1st downpayment.** Per the tax team:
  - For every collection, CWT uses the ledger's own recorded Payment Principal, not a re-derived `Total Collection ÷ 1.12` — real data shows some rows don't follow a clean 12% VAT split (e.g. contract 2000000007819's 1st downpayment: ₱8,075 total, but only ₱4,531.25 recorded as principal), so the ledger's own figure is authoritative. See `principalBasis` in `server/src/services/computation.ts`.
  - If the first payment in the ledger is a round-thousands amount (₱25,000, ₱50,000, ₱100,000, ₱250,000, etc.), it's treated as a reservation fee rather than an amortization payment. Its own recorded principal is *not* trusted (source ledgers book the full gross amount as principal with zero VAT), so its true net-of-VAT value is derived via `÷ 1.12` and added to the very next payment's own recorded principal — that combined figure is the CWT basis for the "1st downpayment." The reservation-fee row itself carries no CWT obligation. Worked example (contract 2000000007819): `25,000 / 1.12 = 22,321.43`, `+ 4,531.25 = 26,852.68` basis, `× 5% = 1,342.63` CWT due. See `applyReservationFeeMerge`.
- **CWT file (OCLP 1606 Summary) side-by-side matching is by calendar month/year, not exact date.** The CWT file's Transaction Date is typically a month-end rollup (e.g. `2021-09-30`) rather than the actual collection date (`2021-09-22`), so ledger rows and CWT file entries are matched when they fall in the same month. When multiple ledger rows share a month, the **last** one (chronologically) claims that month's entries (summed) — e.g. contract 2000000002661's reservation fee (05/10/2018) and two payments dated 05/21/2018 are all May 2018, so the CWT file data lands on the third row, not the first or second. Every CWT file line item is counted exactly once — this is what makes the "CWT File Tax Due" column's total tie out to the CWT file's actual remitted total exactly. Any CWT file entry whose month doesn't match any ledger row is still surfaced as a trailing row (not silently dropped) so the tie-out always holds. See `matchCwtFileByMonth`.
- **"Remitted in Deadline Month?"** flags whether any of the CWT file's actual Date(s) Paid fall in the same calendar month as that row's Applicable CWT Deadline — a simple per-row on-time check (Yes/No), blank when there's nothing to compare.
- **"Difference"** is `Should-Be CWT Due − CWT File Tax Due`, a plain per-row subtraction — not a cumulative or reconciled figure, consistent with the "just do the simple per-row math" direction elsewhere in this engine. It's null for the reservation fee row (which never has a should-be due of its own). When a row has a should-be due but *no* CWT file match at all (as opposed to a match confirming exactly ₱0 remitted), CWT File Tax Due is treated as 0 for this calculation — no remittance record found reads as full exposure, not as "nothing to compare" — while the raw "CWT File Tax Due" column itself stays blank so the table still shows plainly that no CWT file data was found.
- **Per-row penalties** (Surcharge, Compromise Penalty, Interest, Days, Total Penalties) are computed whenever a row's Difference exceeds the ₱1.00 rounding tolerance, reusing the exact same rules as the contract-level penalty calculation (25% surcharge, the Section 6.3.1 compromise bracket table, and 12%/20% interest on a 365-day basis from that row's own Applicable CWT Deadline to today) — anchored on that row's own Difference and deadline, not the contract-level variance. See `computePenalties` reuse in `computePerPaymentLines`.
- **"Total"** is `Difference + Total Penalties` — the full amount owed for that specific row (tax exposure plus every penalty component combined). Null whenever the row has no penalties (fully covered, over-remitted, or nothing to compare).

## Development

```bash
cd server
npm test              # Jest — computation engine has full unit test coverage
npm run build          # TypeScript compile, catches type errors
npm run db:studio      # Prisma Studio at localhost:5555
```

No authentication — this is an internal tool for a single tax/finance team, not internet-exposed, per the FS's stated scope.
