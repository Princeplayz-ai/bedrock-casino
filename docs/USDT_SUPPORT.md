Updated the frontend to support token approve + place bet flows and added token-based DiceGame contract and tests.

How to run tests:
1. npm install
2. npx hardhat test

Notes:
- Tests use settleBetManual(owner-only) to simulate VRF results in unit tests.
- In production, do NOT keep settleBetManual accessible; it's only for testing on local/fork environments.
