# Security Specification (`security_spec.md`)

## 1. Access Patterns & Threat Model
- **Application Context**: SuperEnalotto Combinatorial Optimizer uses a custom Gmail-based session gate (`LoginScreen` + `AdminAccessPanel`) so that it works reliably inside the AI Studio preview iframe without third-party popup blockers, while persisting all state in Cloud Firestore across browsers, devices, and stateless Cloud Run container restarts.
- **Collections**:
  1. `/plays/{playId}`: Stores registered plays (`SavedPlay`), both system-generated and manually entered, so the play history and economic ledger are preserved across browsers and sessions.
  2. `/acl/{emailKey}`: Stores user authorization records (`UserAccessRecord`) keyed by normalized email address.
  3. `/custom_draws/{drawId}`: Stores custom/delta draws added via Smart Paste or CSV import.

## 2. Invariants & Validation Rules
- **`/plays/{playId}`**:
  - `id` must match `playId` and be a non-empty string (`<= 128` chars).
  - `cost` and `savedAmount` must be non-negative numbers (`>= 0` and `<= 1000000`).
  - `mode` must be one of `['pure_coverage', 'superstar', 'manual']`.
  - `status` must be one of `['IN_ATTESA', 'VERIFICATA']`.
  - `columns` must be a list with between `1` and `200` columns.
- **`/acl/{emailKey}`**:
  - `email` must be a valid lowercase email string matching `emailKey` (`<= 254` chars).
  - `role` must be `'ADMIN'` only if `email == 'giuseppe.vitiello@gmail.com'`, otherwise strictly `'USER'`.
  - `status` must be one of `['AUTHORIZED', 'PENDING', 'REJECTED']`.
  - **Primary Admin Protection**: The primary administrator record (`emailKey == 'giuseppe.vitiello@gmail.com'`) can NEVER be deleted (`allow delete: if emailKey != 'giuseppe.vitiello@gmail.com'`) and can NEVER have its role changed from `'ADMIN'` or status changed from `'AUTHORIZED'`.
- **`/custom_draws/{drawId}`**:
  - `id` must match `drawId`, `numbers` must be a list of 6 numbers, and `jolly` must be between 1 and 90.
