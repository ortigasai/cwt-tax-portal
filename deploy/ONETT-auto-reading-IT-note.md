# Pre-ONETT — ONETT Summary: request for an Anthropic API key

**What it is for.** The ONETT Summary page lets the tax team upload scanned ONETT
computation sheets (PDF) and get a summary Excel. Reading a scan (including the
handwritten parts) is done by an AI vision model through Anthropic's API. Without
an API key the portal still accepts the upload but cannot read it.

## What we need from IT

1. **An Anthropic API key** for the company, created in the Anthropic Console
   (console.anthropic.com), ideally in a dedicated workspace for this portal.
   - Please set a **monthly spend limit** on the workspace.
   - Usage is billed per page read (each scanned page is one image plus a short
     text answer). A 100-page packet is a small, bounded cost — see the Console's
     pricing page for current rates.
2. **Outbound HTTPS access** from the portal server (the IIS machine) to
   `https://api.anthropic.com` on port 443.
3. **Approval** that scanned ONETT pages (taxpayer names, TINs, addresses, IRIS
   screenshots) may be sent to Anthropic's API for reading.

## What to do on the server

1. Open `server\.env` on the portal server (the `RepoRoot\server` folder, next to
   the existing `DATABASE_URL`, `DATA_SYNC_DIR`, … entries).
2. Add one line:

   ```
   ANTHROPIC_API_KEY=<the key>
   ```

   Optional lines (defaults are fine):

   ```
   ONETT_VISION_MODEL=claude-sonnet-5-5
   ONETT_READ_CONCURRENCY=3
   ```
3. Restart the backend service so it picks the key up:

   ```
   nssm restart CwtTaxPortalServer
   ```
4. Keep the key out of source control — `server\.env` is git-ignored; do not
   paste the key into chat, tickets or the repo.

## How to check it works

1. Sign in to the portal → **ONETT Summary → New Summary**.
2. The blue/green box should say **"Automatic reading is on."** (If it says it is
   off, the key was not picked up — recheck `.env` and the service restart.)
3. Upload one scanned ONETT PDF. The page shows "Reading page N of M…" and, when
   done, a **Download ONETT Summary (Excel)** button.

## Notes

- The key is only used by the portal's backend; users never see it.
- To stop automatic reading at any time, remove the line and restart the service;
  uploads then wait as "Awaiting data".
- Rotating the key: replace the line and restart the service.
