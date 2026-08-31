// Add deposit webhook endpoint to create onchain_deposits
// This file replaces a portion of backend/index.js with a new POST /deposits/webhook handler

// We'll implement the webhook handler as a small module to import into index.js for clarity.

const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');

module.exports = function(pool, audit) {
  // example payload: { tx_hash, amount, token, from_address, to_address }
  router.post('/deposits/webhook', async (req, res) => {
    const { tx_hash, amount, token, from_address, to_address } = req.body;
    if (!tx_hash || !to_address || !amount) return res.status(400).json({ error: 'tx_hash, to_address and amount required' });
    try {
      // idempotency: if tx_hash already exists, return existing
      const { rows: existing } = await pool.query('SELECT * FROM onchain_deposits WHERE tx_hash=$1 LIMIT 1', [tx_hash]);
      if (existing.length > 0) return res.json(existing[0]);
      const id = uuidv4();
      await pool.query('INSERT INTO onchain_deposits(id,tx_hash,amount,token,from_address,to_address,status) VALUES($1,$2,$3,$4,$5,$6,$7)', [id, tx_hash, amount, token || 'native', from_address || null, to_address, 'detected']);
      await audit('webhook', 'deposit_detected', { id, tx_hash, amount, to_address });
      const { rows } = await pool.query('SELECT * FROM onchain_deposits WHERE id=$1', [id]);
      res.status(201).json(rows[0]);
    } catch (err) {
      console.error('deposit webhook error', err);
      res.status(500).json({ error: 'internal' });
    }
  });

  return router;
};
