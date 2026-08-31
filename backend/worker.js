// Worker: safes balance & metadata sync
// Usage: set RPC env mapping (see README) or set DEFAULT_RPC for network.
// Run with: NODE_ENV=development node worker.js OR npm run worker

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

const GNOSIS_SAFE_MINIMAL_ABI = [
  // getOwners() returns address[] in many Gnosis Safe versions
  "function getOwners() view returns (address[])",
  // getThreshold() returns uint256
  "function getThreshold() view returns (uint256)"
];

async function audit(actorId, action, details) {
  const id = uuidv4();
  await pool.query('INSERT INTO audit_logs(id, actor_id, action, details, created_at) VALUES($1,$2,$3,$4,now())', [id, actorId || 'worker', action, details || {}]);
}

function rpcForNetwork(network) {
  // environment variables mapping: RPC_POLYGON, RPC_MUMBAI, RPC_BSC, RPC_TRON(not supported by ethers)
  const key = `RPC_${network ? network.toUpperCase() : 'DEFAULT'}`;
  if (process.env[key]) return process.env[key];
  // fallback to DEFAULT_RPC or MUMBAI_RPC
  return process.env.DEFAULT_RPC || process.env.MUMBAI_RPC || process.env.RPC_POLYGON || null;
}

async function syncSafesOnce() {
  console.log('[worker] starting sync');
  try {
    const { rows } = await pool.query('SELECT * FROM safes WHERE status=$1', ['active']);
    for (const s of rows) {
      const rpc = rpcForNetwork(s.network);
      if (!rpc) {
        console.warn('[worker] no RPC configured for network', s.network, 'skip', s.id);
        continue;
      }
      try {
        const provider = new ethers.providers.JsonRpcProvider(rpc);
        // fetch native balance
        const balance = await provider.getBalance(s.address);
        // try fetching owners & threshold via minimal ABI
        let owners = [];
        let threshold = null;
        try {
          const contract = new ethers.Contract(s.address, GNOSIS_SAFE_MINIMAL_ABI, provider);
          owners = await contract.getOwners();
          threshold = (await contract.getThreshold()).toString();
        } catch (e) {
          // not a Gnosis Safe or rpc doesn't support call
          // we log and continue
          console.warn('[worker] unable to fetch owners/threshold for', s.address, e.message || e);
        }

        // update DB
        const metadata = { ...(s.metadata || {}), owners: owners, threshold };
        await pool.query('UPDATE safes SET last_balance=$1, metadata=$2, last_verified_at=now() WHERE id=$3', [balance.toString(), JSON.stringify(metadata), s.id]);
        await audit('worker', 'sync_safe', { id: s.id, address: s.address, network: s.network, balance: balance.toString(), owners: owners, threshold });
        console.log('[worker] synced', s.address, 'balance', ethers.utils.formatEther(balance));
      } catch (inner) {
        console.error('[worker] failed for safe', s.id, inner.message || inner);
        await audit('worker', 'sync_safe_error', { id: s.id, error: String(inner) });
      }
    }
  } catch (err) {
    console.error('[worker] sync failed', err.message || err);
    await audit('worker', 'sync_failed', { error: String(err) });
  }
  console.log('[worker] sync finished');
}

// schedule: run every 1 minute (adjust as needed); cron expression: '* * * * *'
cron.schedule(process.env.SAFE_SYNC_CRON || '* * * * *', () => {
  syncSafesOnce();
});

// run once immediately
syncSafesOnce();
