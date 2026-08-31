# Worker & sync docs

This worker polls configured safes and updates their on-chain metadata and balances.

Configuration (env variables placed in backend/.env or process env):
- RPC_POLYGON, RPC_MUMBAI, RPC_BSC etc. A mapping per network used.
- DEFAULT_RPC or MUMBAI_RPC as fallback.
- SAFE_SYNC_CRON cron expression (default: run every minute).

Run locally:
- From repo root: docker-compose up -d postgres
- cd backend && npm install
- set env variables (copy .env.example -> .env and add RPC endpoints)
- npm run worker

What it does:
- Reads active safes from safes table
- For each safe: connects to the network RPC, fetches native balance, attempts to call getOwners() and getThreshold() on contract
- Writes metadata (owners, threshold) and last_balance to safes table and adds an audit log entry

Security notes:
- The worker requires RPC endpoints with read access only. Do NOT place private keys here.
- Adjust cron schedule for production to avoid rate-limits on public RPC providers.
