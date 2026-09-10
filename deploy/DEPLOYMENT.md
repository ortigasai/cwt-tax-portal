# Deploying to the IIS server

Target layout on the server: repo at `C:\cwt-tax-portal`, frontend served by
IIS on port **7070**, backend running as an NSSM Windows service on port
**7171**, reverse-proxied through IIS so the browser only ever talks to 7070.

## One-time server prerequisites

Install these before the first deploy (not scripted — each needs an
installer/admin action on the server itself):

- Node.js (same major version as dev — check with `node -v` on this laptop)
- [NSSM](https://nssm.cc) — put `nssm.exe` on PATH
- IIS, with the [URL Rewrite](https://www.iis.net/downloads/microsoft/url-rewrite)
  and [Application Request Routing](https://www.iis.net/downloads/microsoft/application-request-routing)
  modules
- PostgreSQL, reachable from the server, with a database + user ready for
  this app (a fresh empty database is fine — `deploy-iis.ps1` runs the
  Prisma migrations for you)

## First deploy

1. **Get the code onto the server**, at `C:\cwt-tax-portal`. `deploy\pull-latest.ps1`
   needs to exist there before it can run itself, so for the very first
   deploy, either clone by hand:
   ```powershell
   git clone https://github.com/ortigasai/cwt-tax-portal.git C:\cwt-tax-portal
   ```
   or copy the repo over some other way. From then on, use
   `deploy\pull-latest.ps1` (see "Redeploying" below) instead of a manual
   `git clone`/`git pull`.

2. **Create `server\.env` on the server.** Copy
   `server\.env.production.example` to `server\.env` and fill it in — see
   the comments in that file for what has to differ from the dev laptop's
   `.env` (DB connection, `PORT=7171`, `DATA_SYNC_DIR`/`ZONAL_VALUES_DIR`).

3. **Migrate the data**, from this dev laptop:
   ```powershell
   powershell -ExecutionPolicy Bypass -File deploy\migrate-data.ps1 -ServerHost <server-hostname-or-ip>
   ```
   This copies the Postgres dump, the `CWT ledger_reference` folder, and
   `server\uploads` over to the server, and prints the exact `pg_restore`
   command to run next — run that ON the server.

4. **Run the deploy script**, on the server, as Administrator:
   ```powershell
   powershell -ExecutionPolicy Bypass -File deploy\deploy-iis.ps1
   ```
   Builds both apps, applies migrations, installs/starts the NSSM service,
   and creates/updates the IIS site. It prints a health check at the end.

5. Open `http://localhost:7070` on the server (or its hostname/IP from
   another machine — same firewall/GPO caveats as the dev laptop's LAN
   access apply here too).

## Redeploying after code changes

On the server, in `C:\cwt-tax-portal`:
```powershell
powershell -ExecutionPolicy Bypass -File deploy\pull-latest.ps1
powershell -ExecutionPolicy Bypass -File deploy\deploy-iis.ps1
```

`deploy-iis.ps1` is safe to re-run — it rebuilds both apps, re-applies any
new Prisma migrations, and updates the existing NSSM service/IIS site in
place rather than recreating them.

## Re-syncing data later

Re-run `deploy\migrate-data.ps1` from the dev laptop any time the server's
copy of the ledger data needs to catch up to the dev laptop's. It's a mirror
(`robocopy /MIR`), so it's safe to run repeatedly. The database dump is
*not* auto-restored — you still run the printed `pg_restore` command
yourself, since that's a destructive operation on the server's live data.
