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

// Simple user guard for demo: x-user-id header used to identify actioning user
function userGuard(req, res, next) {
  const userId = req.header('x-user-id');
  if (!userId) return res.status(403).json({ error: 'user id required (dev header x-user-id)' });
  req.userId = userId;
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
      to_address TEXT,
      amount NUMERIC,
      token TEXT,
      status TEXT,
      safe_id TEXT,
      prepared_tx JSONB,
      created_at TIMESTAMP WITH TIME ZONE,
      processed_at TIMESTAMP WITH TIME ZONE
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS change_requests (
      id TEXT PRIMARY KEY,
      type TEXT,
      payload JSONB,
      created_by TEXT,
      created_at TIMESTAMP WITH TIME ZONE,
      required_approvals INTEGER DEFAULT 1,
      status TEXT DEFAULT 'pending'
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS approvals (
      id TEXT PRIMARY KEY,
      change_request_id TEXT,
      approver_id TEXT,
      created_at TIMESTAMP WITH TIME ZONE
    );
  `);
}

// create audit log helper
async function audit(actorId, action, details) {
  const id = uuidv4();
  await pool.query('INSERT INTO audit_logs(id, actor_id, action, details, created_at) VALUES($1,$2,$3,$4,now())', [id, actorId || 'system', action, details || {}]);
}

// Routes - Safes
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

// Audit logs endpoint (dev only)
app.get('/admin/audit-logs', adminGuard, async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 200');
  res.json(rows);
});

// Withdrawals endpoints
// Create withdrawal request (user calls)
app.post('/withdrawals', userGuard, async (req, res) => {
  const { to_address, amount, token } = req.body;
  if (!to_address || !amount) return res.status(400).json({ error: 'to_address and amount required' });
  const id = uuidv4();
  const user_id = req.userId;
  await pool.query('INSERT INTO withdrawals(id,user_id,to_address,amount,token,status,created_at) VALUES($1,$2,$3,$4,$5,$6,now())', [id, user_id, to_address, amount, token || 'native', 'requested']);
  await audit(user_id, 'create_withdrawal', { id, to_address, amount, token });
  const { rows } = await pool.query('SELECT * FROM withdrawals WHERE id=$1', [id]);
  res.status(201).json(rows[0]);
});

// Admin: list withdrawals
app.get('/admin/withdrawals', adminGuard, async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM withdrawals ORDER BY created_at DESC');
  res.json(rows);
});

// Admin: approve withdrawal (records approval). If approvals reach threshold, mark approved and prepare tx
app.post('/admin/withdrawals/:id/approve', adminGuard, async (req, res) => {
  const id = req.params.id;
  const approver = req.header('x-admin-id') || 'admin-dev';
  const { rows: wRows } = await pool.query('SELECT * FROM withdrawals WHERE id=$1', [id]);
  if (wRows.length === 0) return res.status(404).json({ error: 'not found' });
  const wr = wRows[0];
  if (wr.status !== 'requested' && wr.status !== 'pending_approval') return res.status(400).json({ error: 'withdrawal not in approvable state' });

  // create approval record
  const approvalId = uuidv4();
  await pool.query('INSERT INTO approvals(id,change_request_id,approver_id,created_at) VALUES($1,$2,$3,now())', [approvalId, id, approver]);
  await audit(approver, 'approve_withdrawal', { id });

  // count approvals
  const { rows: approvals } = await pool.query('SELECT COUNT(*) FROM approvals WHERE change_request_id=$1', [id]);
  const count = parseInt(approvals[0].count || '0', 10);

  // threshold: default to 2 (or read from env)
  const threshold = process.env.WITHDRAWAL_APPROVAL_THRESHOLD ? parseInt(process.env.WITHDRAWAL_APPROVAL_THRESHOLD) : 2;

  if (count >= threshold) {
    // mark approved
    await pool.query('UPDATE withdrawals SET status=$1 WHERE id=$2', ['approved', id]);
    // prepare tx payload using default safe
    const { rows: safes } = await pool.query('SELECT * FROM safes WHERE is_default=true AND status=$1 LIMIT 1', ['active']);
    let prepare = null;
    if (safes.length > 0) {
      const safe = safes[0];
      const txPayload = { to: wr.to_address, value: wr.amount, data: null, token: wr.token, safe_address: safe.address };
      await pool.query('UPDATE withdrawals SET status=$1, safe_id=$2, prepared_tx=$3 WHERE id=$4', ['prepared', safe.id, txPayload, id]);
      await audit('system', 'prepare_withdrawal', { id, safe_id: safe.id, txPayload });
      prepare = txPayload;
    } else {
      // no default safe found, keep withdrawal approved but unprepared
      await audit('system', 'approve_withdrawal_no_safe', { id });
    }
  }

  const { rows: updated } = await pool.query('SELECT * FROM withdrawals WHERE id=$1', [id]);
  res.json(updated[0]);
});

// Admin: mark as sent after multisig executes
app.post('/admin/withdrawals/:id/mark-sent', adminGuard, async (req, res) => {
  const id = req.params.id;
  const { tx_hash } = req.body;
  await pool.query('UPDATE withdrawals SET status=$1, processed_at=now() WHERE id=$2', ['sent', id]);
  await audit(req.header('x-admin-id') || 'admin-dev', 'mark_withdrawal_sent', { id, tx_hash });
  const { rows } = await pool.query('SELECT * FROM withdrawals WHERE id=$1', [id]);
  res.json(rows[0]);
});

// simple helper to fetch approvals for a withdrawal
app.get('/admin/withdrawals/:id/approvals', adminGuard, async (req, res) => {
  const id = req.params.id;
  const { rows } = await pool.query('SELECT * FROM approvals WHERE change_request_id=$1 ORDER BY created_at', [id]);
  res.json(rows);
});

// Deposit reconciliation (dev helper): mark deposit as reconciled and credit ledger
app.post('/admin/deposits/:id/reconcile', adminGuard, async (req, res) => {
  const id = req.params.id;
  const { rows } = await pool.query('SELECT * FROM onchain_deposits WHERE id=$1', [id]);
  if (rows.length === 0) return res.status(404).json({ error: 'not found' });
  const d = rows[0];
  if (d.status === 'reconciled') return res.status(400).json({ error: 'already reconciled' });

  // find user by to_address
  const { rows: users } = await pool.query('SELECT * FROM users WHERE wallet_address=$1 LIMIT 1', [d.to_address]);
  if (users.length === 0) return res.status(404).json({ error: 'user not found for deposit address' });
  const user = users[0];

  // credit ledger: create or update ledger_balances
  const lbId = uuidv4();
  // simple: add to available and total
  await pool.query('INSERT INTO ledger_balances(id,user_id,token_address,available,reserved,total) VALUES($1,$2,$3,$4,$5,$6)', [lbId, user.id, d.token || 'native', d.amount, 0, d.amount]);

  await pool.query('UPDATE onchain_deposits SET status=$1, reconciled_at=now() WHERE id=$2', ['reconciled', id]);
  await audit(req.header('x-admin-id') || 'admin-dev', 'reconcile_deposit', { id });
  const { rows: updated } = await pool.query('SELECT * FROM onchain_deposits WHERE id=$1', [id]);
  res.json(updated[0]);
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
