# Bankroll Command Center v2

A single-file, local-first bankroll tracker for up to 10 sportsbooks.

## Features

- PIN access lock using browser-side SHA-256 hashing
- Handler name and sports bettor disclaimer
- Starting bankroll setup
- Up to 10 sportsbook balance panels
- Daily closing balance workflow, configured for 9 PM by default
- Running totals, P/L, ROI, best book, average daily move, drawdown
- Canvas bankroll trend chart
- Export to PDF via browser print/save as PDF
- Export to Markdown, TXT, and JSON backup
- JSON import restore
- Sticky header, sticky footer, bottom mobile nav
- Modern black, gray, and green UI

## Deploy on Railway

This app is static. Deploy the repository on Railway and set the start command to serve static files, or use any static hosting adapter.

For a simple Node static server, add a package.json with `serve` if needed:

```json
{
  "scripts": { "start": "npx serve -s . -l $PORT" },
  "dependencies": { "serve": "latest" }
}
```

## Security note

This is local-first browser storage. It is not a bank connection, custodial system, or secure shared database. Do not store sportsbook passwords, account numbers, SSNs, or private financial credentials in it.

## Disclaimer

This tracker is for recordkeeping only. It is not financial, gambling, legal, or tax advice. Sports betting involves risk and can result in losses.
