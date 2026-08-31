const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 4000;
const DB = {
  connectionString: process.env.DATABASE_URL || null,
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASS || 'postgres',
  database: process.env.DB_NAME || 'bedrock'
};

const pool = DB.connectionString ? new Pool({ connectionString: DB.connectionString }) : new Pool({ host: DB.host, port: DB.port, user: DB.user, password: DB.password, database: DB.database });

// Simple dev-only admin guard. In production replace with real auth and RBAC.
function adminGuard(req, res, next) {
  const isAdmin = req.header('x-admin') === 'true';
  if (!isAdmin) return res.status(403).json({ error: 'admin only (dev guard)' });
  next();
}

async function ensureTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS safes (
      id TEXT PRIMARY KEY,
      name TEXT,
      address TEXT NOT NULL,
      network TEXT,
      added_by TEXT,
      added_at TIMESTAMP WITH TIME ZONE,
      status TEXT DEFAULT 'active',
      is_default BOOLEAN DEFAULT false,
      metadata JSONB,
      last_verified_at TIMESTAMP WITH TIME ZONE,
      last_balance NUMERIC,
      notes TEXT
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      actor_id TEXT,
      action TEXT,
      details JSONB,
      created_at TIMESTAMP WITH TIME ZONE
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      wallet_address TEXT,
      status TEXT,
      kyc_status TEXT,
      created_at TIMESTAMP WITH TIME ZONE
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ledger_balances (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      token_address TEXT,
      available NUMERIC DEFAULT 0,
      reserved NUMERIC DEFAULT 0,
      total NUMERIC DEFAULT 0
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS onchain_deposits (
      id TEXT PRIMARY KEY,
      tx_hash TEXT,
      amount NUMERIC,
      token TEXT,
      from_address TEXT,
      to_address TEXT,
      status TEXT,
      reconciled_at TIMESTAMP WITH TIME ZONE
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS bets (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      amount NUMERIC,
      token TEXT,
      game TEXT,
      status TEXT,
      payout_amount NUMERIC,
      created_at TIMESTAMP WITH TIME ZONE,
      settled_at TIMESTAMP WITH TIME ZONE,
      external_request_id TEXT
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS withdrawals (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      amount NUMERIC,
      token TEXT,
      status TEXT,
      safe_id TEXT,
      prepared_tx JSONB,
      created_at TIMESTAMP WITH TIME ZONE,
      processed_at TIMESTAMP WITH TIME ZONE
    );
  `);
}

// create audit log helper
async function audit(actorId, action, details) {
  const id = uuidv4();
  await pool.query('INSERT INTO audit_logs(id, actor_id, action, details, created_at) VALUES($1,$2,$3,$4,now())', [id, actorId || 'system', action, details || {}]);
}

// Routes
app.get('/admin/safes', adminGuard, async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM safes ORDER BY added_at DESC');
  res.json(rows);
});

app.post('/admin/safes', adminGuard, async (req, res) => {
  const { name, address, network, is_default, notes } = req.body;
  if (!address) return res.status(400).json({ error: 'address required' });
  const id = uuidv4();
  const added_by = req.header('x-admin-id') || 'admin-dev';
  await pool.query('INSERT INTO safes(id,name,address,network,added_by,added_at,status,is_default,metadata,notes) VALUES($1,$2,$3,$4,$5,now(),$6,$7,$8,$9)', [id, name || null, address, network || 'polygon', added_by, 'active', !!is_default, JSON.stringify({}), notes || null]);
  await audit(added_by, 'create_safe', { id, name, address, network });
  const { rows } = await pool.query('SELECT * FROM safes WHERE id=$1', [id]);
  res.status(201).json(rows[0]);
});

app.get('/admin/safes/:id', adminGuard, async (req, res) => {
  const id = req.params.id;
  const { rows } = await pool.query('SELECT * FROM safes WHERE id=$1', [id]);
  if (rows.length === 0) return res.status(404).json({ error: 'not found' });
  res.json(rows[0]);
});

// Verify safe (dev placeholder). In production, call RPC or Gnosis Safe API to fetch owners & threshold
app.post('/admin/safes/:id/verify', adminGuard, async (req, res) => {
  const id = req.params.id;
  const { rows } = await pool.query('SELECT * FROM safes WHERE id=$1', [id]);
  if (rows.length === 0) return res.status(404).json({ error: 'not found' });
  // For now, mark verified and attach placeholder metadata
  const metadata = { owners: [], threshold: null, verification: 'placeholder' };
  await pool.query('UPDATE safes SET metadata=$1, last_verified_at=now() WHERE id=$2', [metadata, id]);
  await audit(req.header('x-admin-id') || 'admin-dev', 'verify_safe', { id });
  const { rows: updated } = await pool.query('SELECT * FROM safes WHERE id=$1', [id]);
  res.json(updated[0]);
});

app.post('/admin/safes/:id/sync-balance', adminGuard, async (req, res) => {
  const id = req.params.id;
  // Placeholder: in real flow, call RPC to get balance. Here we set last_balance = 0
  await pool.query('UPDATE safes SET last_balance=$1 WHERE id=$2', [0, id]);
  await audit(req.header('x-admin-id') || 'admin-dev', 'sync_balance', { id });
  const { rows } = await pool.query('SELECT * FROM safes WHERE id=$1', [id]);
  res.json(rows[0]);
});

app.patch('/admin/safes/:id', adminGuard, async (req, res) => {
  const id = req.params.id;
  const fields = req.body || {};
  const allowed = ['name','notes','is_default','status'];
  const updates = [];
  const values = [];
  let idx = 1;
  for (const k of allowed) {
    if (k in fields) {
      updates.push(`${k}=$${idx}`);
      values.push(fields[k]);
      idx++;
    }
  }
  if (updates.length === 0) return res.status(400).json({ error: 'no updatable fields' });
  values.push(id);
  const q = `UPDATE safes SET ${updates.join(', ')} WHERE id=$${idx} RETURNING *`;
  const { rows } = await pool.query(q, values);
  await audit(req.header('x-admin-id') || 'admin-dev', 'edit_safe', { id, fields });
  res.json(rows[0]);
});

app.post('/admin/safes/:id/disable', adminGuard, async (req, res) => {
  const id = req.params.id;
  await pool.query('UPDATE safes SET status=$1 WHERE id=$2', ['disabled', id]);
  await audit(req.header('x-admin-id') || 'admin-dev', 'disable_safe', { id });
  const { rows } = await pool.query('SELECT * FROM safes WHERE id=$1', [id]);
  res.json(rows[0]);
});

// Simple audit logs endpoint (dev only)
app.get('/admin/audit-logs', adminGuard, async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 200');
  res.json(rows);
});

(async () => {
  await ensureTables();
  app.listen(PORT, () => console.log(`Backend listening on ${PORT}`));
})();
