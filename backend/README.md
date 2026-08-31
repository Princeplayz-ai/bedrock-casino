# Backend README

This is a minimal Express + Postgres backend scaffold for the custodial ledger safes API (development only).

Requirements
- Node 18+
- PostgreSQL (see docker-compose.yml for a local Postgres dev service)

Setup (local dev)
1. Copy .env.example to .env and edit DATABASE_URL or DB_* variables.
2. Start Postgres (local or docker): docker-compose up -d postgres
3. Install deps: cd backend && npm install
4. Start server: npm start

Endpoints (require header x-admin: true during dev)
- GET /admin/safes
- POST /admin/safes { name, address, network, is_default, notes }
- GET /admin/safes/:id
- POST /admin/safes/:id/verify
- POST /admin/safes/:id/sync-balance
- PATCH /admin/safes/:id
- POST /admin/safes/:id/disable

Security note: This scaffold uses a development admin header check. Replace with real auth and RBAC in production.
