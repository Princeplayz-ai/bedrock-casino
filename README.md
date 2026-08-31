# Bedrock Casino — MVP Dice Game

This repo contains a minimal provably-fair Dice game using Chainlink VRF v2 and a simple frontend demo.

WARNING: This is a demo scaffold. Do NOT deploy to mainnet or accept real funds without thorough audits, KYC/AML, and proper treasury controls.

What is included:
- contracts/DiceGame.sol — Solidity contract that accepts native-chain bets (MATIC) and settles via Chainlink VRF.
- hardhat.config.js, scripts/deploy.js — hardhat deploy script (fill .env variables before use).
- frontend/ — minimal web UI to connect wallet and place bets (demo).

Quick start (local dev):
1. Install dependencies: npm install
2. Compile: npx hardhat compile
3. Configure .env (PRIVATE_KEY, MUMBAI_RPC, VRF_COORDINATOR, KEY_HASH, SUBSCRIPTION_ID)
4. Deploy to Mumbai: npm run deploy:mumbai

Front-end demo (simple): open frontend/index.html and update the CONTRACT_ADDRESS variable to the deployed address.

Next steps to build full casino:
- Add ERC20 USDT support (safe ERC20 transfers and allowance flows).
- Implement custodial ledger backend + off-chain bet tickets for gas savings.
- Admin panel with RBAC, audit logs, probability controls (with multi-sig approvals).
- Integrate KYC/AML providers and fiat rails.
- Full security audits, formal verification, and bug bounty before production.
