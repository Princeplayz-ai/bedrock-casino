# Reconciliation worker

This worker scans the onchain_deposits table, waits for a configurable number of confirmations, and credits user ledger balances idempotently.

Configuration (backend/.env)
- DEFAULT_RPC or RPC_POLYGON / RPC_MUMBAI etc. (JSON-RPC URLs)
- DEPOSIT_CONFIRMATIONS (default: 3)
- RECONCILE_CRON (cron expression; default runs every 30s: '*/30 * * * * *')

How it works
- The webhooks or indexer should insert rows into onchain_deposits with status NULL or 'detected'.
- The reconciler polls those records, queries the RPC for transaction details and block confirmations.
- Once confirmations >= DEPOSIT_CONFIRMATIONS, it attempts to match the deposit to a user by the to_address.
- If a user is found, it upserts the ledger_balances row and marks the deposit as 'reconciled'. If not found, it marks status 'confirmed_no_user'.
- All actions are logged to audit_logs.

Run locally
- Ensure DB is running (docker-compose up -d postgres)
- Set RPC env var(s) and DB env vars in backend/.env
- From backend directory: npm install
- Run: npm run reconcile

Security notes
- This worker only needs read-only RPC endpoints.
- Ensure DEPOSIT_CONFIRMATIONS is set sufficiently high for the target network.
- Do not process deposits from untrusted indexers without additional verification.
