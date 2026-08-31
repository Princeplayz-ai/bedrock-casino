// Reconciliation worker: polls onchain_deposits, waits for confirmations, and credits ledger balances idempotently
// Usage: set RPC env mapping (see README) or set DEFAULT_RPC for network.
// Run with: NODE_ENV=development node reconcile_worker.js OR npm run reconcile

require('dotenv').config();
const { Pool } = require('pg');
const { ethers } = require('ethers');
const cron = require('node-cron');
const { v4: uuidv4 } = require('uuid');

const DB = {
  connectionString: process.env.DATABASE_URL || null,
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASS || 'postgres',
  database: process.env.DB_NAME || 'bedrock'
};

const pool = DB.connectionString ? new Pool({ connectionString: DB.connectionString }) : new Pool({ host: DB.host, port: DB.port, user: DB.user, password: DB.password, database: DB.database });

async function audit(actorId, action, details) {
  const id = uuidv4();
  await pool.query('INSERT INTO audit_logs(id, actor_id, action, details, created_at) VALUES($1,$2,$3,$4,now())', [id, actorId || 'reconciler', action, details || {}]);
}

function rpcForNetwork(network) {
  const key = `RPC_${network ? network.toUpperCase() : 'DEFAULT'}`;
  if (process.env[key]) return process.env[key];
  return process.env.DEFAULT_RPC || process.env.MUMBAI_RPC || process.env.RPC_POLYGON || null;
}

async function processDeposit(d) {
  try {
    // Check idempotency
    if (d.status === 'reconciled') return;

    const rpc = rpcForNetwork(d.network || 'polygon');
    if (!rpc) {
      console.warn('[reconciler] no RPC for network', d.network, 'skip', d.id);
      return;
    }
    const provider = new ethers.providers.JsonRpcProvider(rpc);
    const tx = await provider.getTransaction(d.tx_hash);
    if (!tx || !tx.blockNumber) {
      // not yet mined
      console.log('[reconciler] tx not mined yet', d.tx_hash);
      return;
    }
    const latest = await provider.getBlockNumber();
    const confirmations = process.env.DEPOSIT_CONFIRMATIONS ? parseInt(process.env.DEPOSIT_CONFIRMATIONS) : 3;
    const confs = latest - tx.blockNumber + 1;
    if (confs < confirmations) {
      console.log('[reconciler] tx not enough confirmations', confs, 'needed', confirmations);
      return;
    }

    // At this point, mark deposit as confirmed -> reconciled and credit ledger
    // Find user by to_address
    const toAddress = (d.to_address || '').toLowerCase();
    const { rows: users } = await pool.query('SELECT * FROM users WHERE lower(wallet_address)=$1 LIMIT 1', [toAddress]);
    if (users.length === 0) {
      console.warn('[reconciler] no user found for deposit to', toAddress);
      // mark deposit as detected but not reconciled
      await pool.query('UPDATE onchain_deposits SET status=$1 WHERE id=$2', ['confirmed_no_user', d.id]);
      await audit('reconciler', 'deposit_no_user', { id: d.id, to: toAddress });
      return;
    }
    const user = users[0];

    // guard: check if already reconciled (double-check)
    const { rows: existing } = await pool.query('SELECT * FROM onchain_deposits WHERE tx_hash=$1 AND status=$2', [d.tx_hash, 'reconciled']);
    if (existing.length > 0) {
      console.log('[reconciler] already reconciled', d.tx_hash);
      return;
    }

    // credit ledger: upsert ledger_balances for user's token
    const token = d.token || 'native';
    // try to find existing balance row
    const { rows: lbRows } = await pool.query('SELECT * FROM ledger_balances WHERE user_id=$1 AND token_address=$2 LIMIT 1', [user.id, token]);
    if (lbRows.length === 0) {
      const id = uuidv4();
      await pool.query('INSERT INTO ledger_balances(id,user_id,token_address,available,reserved,total) VALUES($1,$2,$3,$4,$5,$6)', [id, user.id, token, d.amount, 0, d.amount]);
    } else {
      const lb = lbRows[0];
      // update totals
      const newAvailable = Number(lb.available) + Number(d.amount);
      const newTotal = Number(lb.total) + Number(d.amount);
      await pool.query('UPDATE ledger_balances SET available=$1, total=$2 WHERE id=$3', [newAvailable, newTotal, lb.id]);
    }

    await pool.query('UPDATE onchain_deposits SET status=$1, reconciled_at=now() WHERE id=$2', ['reconciled', d.id]);
    await audit('reconciler', 'reconciled_deposit', { id: d.id, tx: d.tx_hash, user: user.id, amount: d.amount, token });
    console.log('[reconciler] reconciled deposit', d.tx_hash, 'for user', user.id);
  } catch (err) {
    console.error('[reconciler] failed processing deposit', d.id, err.message || err);
    await audit('reconciler', 'reconcile_error', { id: d.id, error: String(err) });
  }
}

async function syncOnce() {
  console.log('[reconciler] scanning deposits');
  try {
    const { rows } = await pool.query("SELECT *, 'polygon' as network FROM onchain_deposits WHERE status IS NULL OR status='detected' ORDER BY reconciled_at NULLS FIRST LIMIT 50");
    for (const d of rows) {
      await processDeposit(d);
    }
  } catch (err) {
    console.error('[reconciler] scan failed', err.message || err);
    await audit('reconciler', 'scan_failed', { error: String(err) });
  }
}

// run every 30 seconds by default
cron.schedule(process.env.RECONCILE_CRON || '*/30 * * * * *', () => {
  syncOnce();
});

// run immediately
syncOnce();
