# Free-OCR experiment for ONETT Summary (not wired into the app)

Tesseract.js (offline) + form-line removal + arithmetic cross-checks, scored against the
30 reviewed ONETT sheets of "ONETT WITH IRIS PASIG 10.10.2026.pdf" (2026-10-16).

Result: 0 of 30 records fully exact. Per column exact (of 30): name 5, selling price 13,
surcharge 15, interest 14, compromise 21, tax base/EWT 20, FMV 22, location 23, class 23,
area RC 22 / PS 24, ZV/sqm 24. OCR reads digits on these ~150 dpi scans exactly only ~50%
of the time (5/3, 6/4, 8/3 confusions), so every record would still need hand-verification.

What worked: payment-schedule totals rows (clean tables), FMV rule (25,000/sqm units,
16,000/sqm parking: 42/42), ZV = area x ZV/sqm (42/42), EWT = 5% x base, DST = P15/P1,000.
What did not: buyer names, selling price, penalties on single-payment sheets, multi-page
schedules.

Files import from "./services/..." so they only compile when placed back in src/services.
Needs: npm i tesseract.js@5 jimp@0.22 @tesseract.js-data/eng
