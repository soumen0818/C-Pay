# Key custody

C-Pay does not issue or custody the USDC asset. Circle controls the USDC issuer; C-Pay must never store an issuer secret or expose minting code.

## Keys operated by C-Pay

| Account | Purpose | Recommended control |
| --- | --- | --- |
| Sponsor | Creates accounts and pays sponsored reserves and fees | Isolated secret store, least-privilege service access, rotation runbook |
| Distribution | Holds testnet USDC used for pilot distribution | Separate secret store, low-balance monitoring, strict inventory limits |
| User | Signs user payments | Encrypted user-controlled wallet backup; never sent to the relayer |

Production money-in must come from a licensed on-ramp partner. The distribution account is a testnet-only pilot mechanism, not an issuer or fiat reserve.

---

## 1. Threat Model & Key Custody Challenges

1. **Host Compromise / Server Breach**: Exfiltration of `.env` leads to total loss of sponsor funds and distribution liquidity.
2. **Insider Threat & Operator Mistake**: Accidental logging, accidental commits, or shared credentials.
3. **Single Point of Failure (SPOF)**: Inability to rotate compromised keys without downtime.

To eliminate raw secret exposure in application logic and mitigate key drainage attacks, C-Pay enforces a **tiered least-privilege key architecture** managed by the **`KeyManager`** custody abstraction and backed by **Stellar Multi-Signature (Multisig)**.

---

## 2. Key Inventory & Separation of Privilege (Least Privilege)

Every key in the C-Pay ecosystem has a distinct role, security tier, and authorization threshold:

| Key Role | Purpose | Storage Tier | Signer Mechanism | Multi-Sig / Threshold |
| :--- | :--- | :--- | :--- | :--- |
| **Asset Issuer (CPINR)** | Mints/Burns CPINR tokens, manages asset flags (auth_required, revoking). | **Tier 1: Cold Storage** | Ledger Nano X / AWS CloudHSM | **3-of-5 M-of-N Multisig** (Core Team Quorum) |
| **Soroban Contract Admin** | Upgrades smart contracts, pauses protocol in emergency. | **Tier 1: Cold Storage** | Hardware Security Module / Air-Gapped | **3-of-5 Multisig** |
| **Relayer Distribution** | Fulfills Add Money liquidity requests to user wallets. | **Tier 2: Warm Storage** | AWS KMS / GCP Cloud KMS (Ed25519) | **2-of-3 Multisig** (Relayer + Security Co-Signer) |
| **Relayer Sponsor** | Sponsors account creation reserves (1.5 XLM) and wraps fee bumps. | **Tier 3: Hot Signing** | AWS KMS / HashiCorp Vault | **1-of-2 with daily drain caps** |
| **Ledger Ingest Worker** | Ingests on-chain transactions into Postgres. | **Tier 4: Read-Only** | Read-Only Stellar Horizon API | **No signing privileges** |

---

## 3. Storage & Signing Architecture

### 3.1 Pre-Mainnet / Testnet Pilot Posture (Current Implementation)
In the current testnet pilot deployment:
- **Consolidated Signing Path**: All transaction and fee-bump signing in the relayer service (`/accounts/prepare`, `/payments/submit`, `/accounts/claim-distribution-balance`) is routed strictly through the `KeyManager` abstraction (`relayer-service/keyManager.js`).
- **Encapsulated Secrets**: Route handlers and transaction builders never access raw secret keys. Keys are loaded into `KeyManager` upon startup using its `local-keypair` driver (`SIGNER_PROVIDER=env`).
- **Signing Velocity & Anomaly Monitoring**: `KeyManager` audits signing activity and triggers alerts if signing velocity exceeds threshold (`MAX_SIGNS_PER_MINUTE`).
- **Defensible Pilot Posture**: Testnet operation with environment-injected secrets managed through a single custody interface is an acceptable pre-mainnet pilot posture.

### 3.2 Mainnet Launch Gate: Cloud KMS / HSM Integration (Outstanding)
Prior to public mainnet launch:
- **Zero Plaintext Secrets**: The `local-keypair` driver will be replaced by a production Cloud KMS / HSM driver (AWS KMS `ECC_NIST_ED25519` / GCP Cloud KMS / HashiCorp Vault). No raw secret keys (`SPONSOR_SECRET`, `DISTRIBUTION_SECRET`) may exist in environment variables, configuration files, or container filesystems.
- **IAM Instance Roles**: Relayer processes authenticate to KMS using IAM instance roles or Workload Identity without static credentials.
- **Hardware-Backed Ed25519 Signing**: The KMS signs the 32-byte transaction hash directly using asymmetric keys whose private seeds never leave hardware security boundaries.
- **CloudTrail Audit Logging**: Every `kms:Sign` request logs caller identity, IP, transaction hash, and timestamp.
- **Mainnet Gate Status**: ⏳ **Outstanding**. The production KMS driver is tracked as a blocking gate before mainnet release. Placeholder stubs have been removed in favor of explicit configuration checks.

---

## 4. Stellar Multi-Signature Architecture

Stellar native accounts support weights and thresholds on low, medium, and high threshold operations:

```text
Low Threshold (1): Allow trust, bump sequence
Medium Threshold (2): Payments, sponsor reserves, manage data
High Threshold (3): Account merge, set options (adding/removing signers)
```

### 4.1 Distribution Account Multisig Policy
- **Primary Signer (Relayer KeyManager)**: Weight = 1
- **Automated Risk Engine (Co-Signer Worker)**: Weight = 1
- **Emergency Cold Key**: Weight = 2
- **Thresholds**: `Low = 1`, `Medium = 2`, `High = 3`
- *Outcome:* The relayer alone cannot drain funds to arbitrary destinations without passing the automated risk engine co-signer check (or invoking emergency cold key quorum).

### 4.2 Asset Issuer Multisig Policy
- **Signers**: 5 core team member hardware keys (weight 1 each).
- **Master Key Weight**: Set to 0 (master key disabled).
- **Thresholds**: `Low = 3`, `Medium = 3`, `High = 3`.
- *Outcome:* No individual person or compromised server can mint CPINR or alter contract state unilaterally.

---

## 5. Zero-Downtime Key Rotation Runbook

When a key reaches its rotation period (standard: 90 days) or a suspected compromise occurs, follow this tested rotation procedure.

### 5.1 Rotation Workflow Diagram

```text
1. Provision New KMS Key
       │
2. Add New Key as Signer on Stellar Account (Weight = Existing Weight)
       │
3. Update Relayer KeyManager Config (Hot Reload / Deployment)
       │
4. Verify Relayer is Signing with New Key
       │
5. Remove Old Signer from Stellar Account (Set Weight = 0)
```

### 5.2 Step-by-Step Rotation Drill (Rehearsed on Testnet)

#### Step 1: Generate & Register New Key in KMS
```bash
# Example: Provision new AWS KMS Key
aws kms create-key --key-spec ECC_NIST_ED25519 --key-usage SIGN_VERIFY --description "cpay-sponsor-v2"
# Export new public key: G_NEW_SPONSOR_KEY
```

#### Step 2: Add New Signer to Stellar Account
Submit a `setOptions` transaction from the existing account master/multisig signer:
```javascript
const tx = new StellarSdk.TransactionBuilder(account, { fee: 100, networkPassphrase })
  .addOperation(StellarSdk.Operation.setOptions({
    signer: {
      ed25519PublicKey: G_NEW_SPONSOR_KEY,
      weight: 1, // Add new signer with valid signing weight
    },
  }))
  .setTimeout(60)
  .build();

tx.sign(currentKeypair);
await server.submitTransaction(tx);
```

#### Step 3: Hot-Rotate in Relayer KeyManager
The `KeyManager` supports zero-downtime runtime rotation via `rotateKey(role, newIdentifier)`:
```javascript
// Relayer dynamically switches active signer:
keyManager.rotateKey('sponsor', 'kms://arn:aws:kms:region:account:key/cpay-sponsor-v2');
```

#### Step 4: Verify Transactions
Send a test `/accounts/prepare` request and confirm on Horizon that transactions are signed by `G_NEW_SPONSOR_KEY`.

#### Step 5: Decommission Old Signer on Stellar
Once the new key is actively signing:
```javascript
const removeOldSignerTx = new StellarSdk.TransactionBuilder(account, { fee: 100, networkPassphrase })
  .addOperation(StellarSdk.Operation.setOptions({
    signer: {
      ed25519PublicKey: G_OLD_SPONSOR_KEY,
      weight: 0, // Setting weight to 0 removes the signer completely
    },
  }))
  .setTimeout(60)
  .build();

removeOldSignerTx.sign(newKeypair);
await server.submitTransaction(removeOldSignerTx);
```

---

## 6. Key Rotation Rehearsal Status

> [!IMPORTANT]
> **Status: Tracked as Outstanding Mainnet Gate**
> While the rotation procedure is fully specified in Section 5 and runtime rotation is supported by `KeyManager.rotateKey()`, an end-to-end multi-operator rehearsal under live testnet traffic is **tracked as an outstanding operational deliverable** prior to mainnet launch.

### 6.1 Rehearsal Protocol & Checklist (Owed Prior to Mainnet)
To sign off on the rehearsal gate prior to mainnet deployment, the operations team will perform and record the following drill on Stellar Testnet:
1. **Pre-flight verification**: Query Horizon for current signer weights and thresholds on the sponsor and distribution accounts.
2. **Add secondary signer**: Submit a `setOptions` transaction adding secondary signer `K2` with weight = 1:
   ```javascript
   const tx = new StellarSdk.TransactionBuilder(account, { fee: 100, networkPassphrase })
     .addOperation(StellarSdk.Operation.setOptions({
       signer: { ed25519PublicKey: G_NEW_KEY, weight: 1 },
     }))
     .setTimeout(60)
     .build();
   ```
3. **Hot-rotate active signer in Relayer**: Invoke `keyManager.rotateKey(role, newSecretOrKmsUri)` without restarting the relayer.
4. **Traffic verification**: Verify new transactions (`/accounts/prepare`, `/payments/submit`) are signed by `G_NEW_KEY` and succeed on Horizon.
5. **Revoke primary signer**: Submit a `setOptions` transaction setting `G_OLD_KEY` weight to 0.
6. **Negative authentication test**: Confirm transactions attempting to use revoked key `G_OLD_KEY` fail with `tx_bad_auth`.
7. **Sign-off log**: Record execution date, network ledger sequence numbers, transaction hashes, and operator sign-offs in this runbook.

---

## 7. Monitoring, Alarms & Incident Response

### 7.1 Balance Alarms
- **Sponsor Account Low Balance**: Triggered when XLM balance < `LOW_XLM_THRESHOLD` (default 10 XLM).
- **Distribution Account Low Balance**: Triggered when CPINR balance < `LOW_CPINR_THRESHOLD` (default 1000 CPINR).
- **Webhook Alerts**: Dispatched immediately via `ALERT_WEBHOOK_URL` to PagerDuty / Slack.

### 7.2 Anomaly & Velocity Detection
- **Signing Velocity Threshold**: Triggered if `KeyManager` exceeds 120 signatures/minute (`MAX_SIGNS_PER_MINUTE`).
- **Unexpected Source Account Check**: Relayer enforces `requireWalletOwnership()` on every request to prevent signing for unauthorized accounts.
- **Circuit Breaker**: Keep the legacy testnet faucet disabled (`ENABLE_TESTNET_FAUCET=false`) and revoke the distribution key if unauthorized signing is detected.

---

## 8. Summary of Compliance & Acceptance Criteria

| Requirement | Implementation | Status |
| :--- | :--- | :--- |
| **Written Custody Plan** | [docs/custody.md](custody.md) detailing inventory, storage, rotation, and alerting | ✅ Complete |
| **Unified Signing Path** | All relayer transaction signing routed exclusively through `KeyManager` (`relayer-service/keyManager.js`) | ✅ Complete |
| **Pre-Mainnet Pilot Custody Posture** | Testnet uses local-keypair driver in `KeyManager` with env secrets; route handlers have zero raw secret access | ✅ Complete |
| **No Raw Secrets in Production (Cloud KMS / HSM)** | AWS KMS / Vault driver integration in `KeyManager` | ⏳ Outstanding Mainnet Gate |
| **Least Privilege & Role Separation** | Strict separation between Issuer, Sponsor, and Distribution keys | ✅ Complete |
| **Multi-Signature Policy** | M-of-N multisig policies for funds and issuer controls documented | ⏳ Planned for Mainnet |
| **Rotation Runbook** | Zero-downtime rotation protocol documented in Section 5 | ✅ Complete |
| **Live Testnet Rotation Rehearsal** | Multi-operator rehearsal under live traffic | ⏳ Outstanding Mainnet Gate |
| **Balance & Activity Alarms** | KeyManager velocity tracking and server balance monitoring alerts | ✅ Complete |
