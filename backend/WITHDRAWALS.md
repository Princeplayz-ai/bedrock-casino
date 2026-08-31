# Withdrawals & approvals

This directory adds a simple withdrawals lifecycle and admin approval flow for demo purposes. Features:

- Users can create withdrawal requests via POST /withdrawals (dev requires x-user-id header).
- Admins can list withdrawals, approve them (POST /admin/withdrawals/:id/approve). Approvals are recorded in approvals table.
- Once the number of approvals reaches WITHDRAWAL_APPROVAL_THRESHOLD (env, default 2), the system automatically selects the default Safe (safes.is_default = true) and prepares a Gnosis Safe tx payload: {to, value, data, token, safe_address} and stores it on the withdrawal record as prepared_tx.
- Admins mark withdrawals as sent after multisig execution via POST /admin/withdrawals/:id/mark-sent.

Security & production notes
- This is a minimal demo flow. In production:
  - Integrate full RBAC and user authentication (JWT, sessions, etc.).
  - Ensure withdrawals are subject to AML/KYC checks before approval.
  - Use a proper multisig execution flow (Gnosis Safe transaction creation + signing + execution) instead of ad-hoc marking as sent.
