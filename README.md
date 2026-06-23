# Bankroll Accounting Pro - Login Fix

Railway-ready sportsbook bankroll management app. This version intentionally removes the bet logger and focuses on daily bankroll accounting.

## Features

- Secure access lock with `ADMIN_PASSWORD`
- Handler profile
- Up to 10 sportsbooks
- Starting bankroll baseline
- 9 PM daily close workflow
- Daily balance snapshots
- Running totals, ROI, weekly/monthly P/L
- Drawdown, best/worst day, sportsbook rankings
- Markdown/TXT export and browser PDF print
- SQLite persistence
- Railway/Nixpacks config

## Railway Variables

Set these in Railway:

```text
NODE_ENV=production
SESSION_SECRET=use-a-long-random-string
ADMIN_PASSWORD=your-login-password
```

## Windows GitHub Update

1. Extract this ZIP.
2. Copy everything inside `bankroll-accounting-pro` into your cloned `Bankroll-Tracker` repo folder.
3. Replace old files.
4. Open GitHub Desktop.
5. Commit: `Remove bet logger and add bankroll accounting app`.
6. Push origin.
7. Redeploy on Railway.

## Local Run

```bash
npm install
npm start
```

Open `http://localhost:3000`.


## Login Fix Notes

This build makes the Railway `ADMIN_PASSWORD` variable authoritative on every deploy. If you change `ADMIN_PASSWORD` in Railway, redeploy and the app will accept the new password.

If you are locked out:

1. Railway -> Variables -> set `ADMIN_PASSWORD` to a simple test value with no quotes, such as `Test12345!`
2. Redeploy the latest deployment.
3. Open the site in a private/incognito window.
4. Login with exactly that value.
5. Change it later to a stronger password.


## Day 0 Initial Allocation

This build adds a first-run Day 0 setup flow. Enter your starting bankroll, sportsbook starting balances, and cash reserve/unallocated amount. The app validates that sportsbook balances plus cash reserve equals the starting bankroll, then saves a Day 0 snapshot. Future ROI, growth, drawdown, and reports use this baseline.
