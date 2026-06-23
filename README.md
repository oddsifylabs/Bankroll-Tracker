# Bankroll Accounting Pro

Railway-ready bankroll management web app for sportsbook balance accounting.

## Current build

Version: `v1.1.0`

## Features

- Access lock using `ADMIN_PASSWORD`
- Handler profile
- Day 0 initial bankroll allocation
- Cash reserve / unallocated bankroll
- Up to 10 sportsbooks
- Update Bankroll workflow
- SQLite persistence on Railway Volume
- Database verification in Settings
- Guarded data reset tools
- Snapshot / bankroll update history
- Full JSON backup and restore
- Markdown, TXT, CSV, and PDF/print exports
- Sportsbook performance rankings
- Advanced analytics:
  - bankroll growth chart
  - daily P/L chart
  - allocation chart
  - drawdown chart
  - monthly ROI chart
  - season high
  - season low
  - current drawdown
  - peak ROI
  - best/worst day

## Railway variables

Set these in Railway:

```text
NODE_ENV=production
SESSION_SECRET=make-this-a-long-random-string
ADMIN_PASSWORD=your-admin-password
DATA_DIR=/app/data
```

## Railway Volume

Attach a Railway Volume and mount it at:

```text
/app/data
```

The app stores SQLite data at:

```text
/app/data/bankroll.sqlite
```

## Deploy from Windows with GitHub Desktop

1. Extract this ZIP.
2. Copy all files into your repo folder:

```text
C:\GitHub\Bankroll-Tracker
```

3. Replace existing files.
4. Open GitHub Desktop.
5. Commit with:

```text
Add backup, history, rankings, and advanced analytics
```

6. Push origin.
7. Railway will redeploy.

## Create the Git tag after pushing

In PowerShell inside your repo folder:

```powershell
cd C:\GitHub\Bankroll-Tracker
git tag -a v1.1.0 -m "Bankroll Accounting Pro v1.1.0"
git push origin v1.1.0
```

If you prefer to tag this as the first stable release, use:

```powershell
git tag -a v1.0.0 -m "Bankroll Accounting Pro v1.0.0"
git push origin v1.0.0
```

## Backup / Restore

Go to Reports:

- **Download Full Backup** creates a full JSON backup.
- **Restore Selected Backup** replaces bankroll data while keeping your current login password.

Download a backup before any major reset, deploy, or experiment.

## Responsible use disclaimer

This app is for bankroll accounting and personal recordkeeping only. It does not recommend bets, provide financial advice, guarantee outcomes, or reduce the risks of gambling.
