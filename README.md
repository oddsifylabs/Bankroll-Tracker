# Bankroll Tracker Pro

Railway-ready sportsbook bankroll tracker with login, SQLite persistence, daily closing balances, analytics, sportsbook management, and exports.

## Local Windows setup

```powershell
cd C:\GitHub\Bankroll-Tracker
npm install
copy .env.example .env
npm start
```

Open http://localhost:3000

## Railway

Set this environment variable in Railway:

```text
JWT_SECRET=use-a-long-random-secret
```

Railway will run:

```text
npm start
```

## Notes

The app uses SQLite stored in `data/bankroll.db`. For production multi-user/cloud sync, upgrade to Postgres/Supabase.
