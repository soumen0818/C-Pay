# C-Pay: Project → Product

**Status:** Working document. Written 15 July 2026, against commit `8c08402`.
**Scope:** What the product idea has to become, what is wrong with it today, what to remove (merchant), what to fix (bugs), and what to do about branding.

---

## 0. The one-paragraph verdict

C-Pay today is a well-built **engineering demo** of a hard thing: it hides Stellar accounts, trustlines, fee bumps, and secret seeds behind a PIN and a QR code, and it does that competently. But it is **not a product**, and the reason is not the code — it is the idea. "UPI for Stellar" positions C-Pay in direct competition with UPI, in the one market where UPI is free, instant, universal, and processes 23.2 billion transactions a month. On top of that, the token the whole app is denominated in (CPINR) is, under Indian law, a Virtual Digital Asset — which means every coffee a user buys with it triggers a 1% TDS and a 30% tax on any gain, with no loss set-off. A payments product cannot survive that. To become a product, C-Pay has to stop competing with UPI and start doing the thing UPI cannot do: **move money into India from outside India**. Everything else in this document follows from that one decision.

---

## 1. What C-Pay actually is today

Stripping the marketing away, here is the real system:

| Layer | What it really does |
| --- | --- |
| **Mobile app** (Expo/RN) | Generates a Stellar keypair on device, encrypts it with a PIN-derived key, stores it in SecureStore. Signs payment XDRs locally. |
| **Supabase** | Email OTP auth, user profiles, an encrypted wallet backup blob, and a **client-written** transaction table. |
| **Relayer** (Express) | Holds the sponsor + distribution + contract-admin + relayer secrets. Sponsors account creation, pays fees via fee-bump, and hands out free CPINR. This is the system's centre of gravity. |
| **Soroban contract** | Records merchant registrations and "payment intents." **Never touches funds.** |
| **CPINR** | A Stellar asset issued by a testnet key you control. Not backed by anything. Not redeemable. |

Two things follow from this that the README does not say out loud:

**The blockchain is not load-bearing.** The Soroban contract stores a `token: Address` in its config and then never calls it. `confirm_intent` takes a payment hash from the relayer and writes it down — it verifies nothing. Payments are ordinary Stellar classic payments, fee-bumped by a server you run. If you deleted the contract tomorrow, the app would work identically. Right now Soroban is a database with worse latency, worse failure modes, and a TTL.

**The relayer is a bank.** It custodies the keys that create accounts, pay all fees, and mint the balance users spend. Users hold their own signing key (genuinely good) but every economically meaningful action routes through one Express process on a Render free instance. "Decentralised" is not a claim this architecture can make, and it should stop trying to.

None of this makes the work bad. It makes the *story* wrong, and the story is what you are converting into a product.

---

## 2. The gaps in the idea

### Gap 1 — You picked a fight with UPI, and UPI is free

UPI did **23.2 billion transactions worth ₹29.9 trillion in May 2026** ([NPCI via ANI](https://www.aninews.in/news/business/upi-hits-new-high-in-may-2026-with-232-billion-transactions-worth-rs-299-trillion-npci-data-shows20260602155337/)). It is instant, it works at every kirana store, and P2P is free to the user.

Against that, C-Pay offers: a slower settlement path, a token nobody accepts, an app the recipient must also install, and a balance that isn't real rupees. There is no user for whom this is a better Tuesday. "UPI but on blockchain" is not a value proposition — **it is a description of a downgrade.** Every feature in the app that competes with UPI (domestic P2P, merchant QR, scan-to-pay at a shop) is competing for a job that is already done, for free, better.

### Gap 2 — Indian tax law makes CPINR unusable as a payment token

This is the hard blocker, and it is not a "later, after we get a licence" problem — it is arithmetic.

Under §115BBH and §194S, a Virtual Digital Asset transfer in India attracts a **flat 30% tax on gains (+4% cess), with no loss set-off**, and a **1% TDS on transfers** above ₹10,000–₹50,000/year depending on the payer ([ClearTax](https://cleartax.in/s/cryptocurrency-taxation-guide), [CoinDCX](https://coindcx.com/blog/cryptocurrency/crypto-tax-guide-india/)). Stablecoins are explicitly inside the VDA definition and remain in a regulatory grey zone; the RBI's own answer to digital rupees is the e₹ CBDC, not a private token.

So: a user pays ₹200 for chai with CPINR. That is a VDA *transfer*. It is a taxable event. It carries TDS. The merchant receiving it holds a VDA and owes 30% on any gain when they convert. **Nobody is going to do this.** No amount of UX polish fixes a tax code. Any roadmap that says "add KYC, then fiat on-ramp, then real CPINR" is a roadmap to a product that is illegal to use as intended.

**Conclusion: C-Pay must never issue its own INR-pegged token.** Delete that ambition. It is the single most dangerous idea in the repo — an unbacked, non-redeemable, privately-issued rupee substitute is not a payments feature, it is a liability with a logo.

### Gap 3 — The trust model is inverted

The transaction ledger is **written by the client**. `App/supabase_schema.sql:448` lets any authenticated user INSERT a transaction row as long as their own wallet is the sender *or the recipient*:

```sql
CREATE POLICY "transactions_insert_participant" ON transactions
FOR INSERT
WITH CHECK (auth.uid() IS NOT NULL AND (
    from_address = current_wallet_address()
    OR to_address = current_wallet_address()));
```

Which means I can insert a row saying I received ₹50,000 from you, `status: 'success'`, with any `tx_hash` I like. And because `refresh_merchant_totals()` (`supabase_schema.sql:562`) *recomputes merchant revenue by summing that same table*, a merchant's dashboard revenue is a number their own customers can write. This is the fake-payment-screenshot scam, except you built it into the schema.

A payments company's ledger is its only real asset. **It cannot be writable by the people it describes.** The transaction table must be populated server-side from Horizon, and be read-only to clients. This is not a bug to patch — it is a foundational property the current design does not have.

### Gap 4 — No revenue model exists anywhere

There is no fee, no spread, no float, no subscription, nothing. The relayer *pays* — sponsor XLM for account reserves, fees for every fee-bump, and free CPINR out of the distribution account. Every user costs you money and none of them can pay you. This is fine for a pilot with six testers. It is not a business, and the roadmap never addresses it.

### Gap 5 — "Add Money" is a faucet wearing a suit

`POST /add-money` hands out free tokens on a cooldown. The README frames this as a precursor to a fiat bridge. It isn't — the fiat bridge is a completely different system (payment gateway, nodal account, reconciliation, refunds, chargebacks, PMLA/KYC). The faucet teaches you nothing about building it and creates the false impression that the money-in problem is 80% solved. It is 0% solved.

---

## 3. Where the actual opportunity is

UPI's superpower is *domestic*. Its blind spot is *the border*.

- India is the **world's largest remittance recipient — ~$138B in 2024** ([World Bank](https://data.worldbank.org/indicator/BX.TRF.PWKR.CD.DT?locations=IN)).
- Sending $200 into India costs **3.2%–4.8% from the GCC** and **~6% from Europe** — against a UN target of 3% ([GCC corridor study](https://www.mahadmanpowers.co.in/research/india-to-gcc-remittance-corridors-2026/report.pdf)).
- Money takes 1–3 days and passes through correspondent banks.
- **UPI cannot fix this.** It is a domestic rail. It starts *after* the money is already in India.

And this is the thing Stellar is actually good at, and has real traction in: cash-in/cash-out anchors, MoneyGram's LatAm corridors, USDC settlement. B2B stablecoin payment volume grew **>700% YoY** in 2025 ([OpenFX](https://www.openfx.com/stablecoins-cross-border-payments-report-2026)).

So the reframe:

> **Stop building "UPI on Stellar." Build the pipe that ends in UPI.**
>
> A worker in Dubai sends USDC on Stellar. It settles in seconds for cents. A licensed Indian partner converts it and pushes INR into the recipient's bank account — via UPI/IMPS. The recipient in India never installs anything, never hears the word "blockchain," and gets more money than Western Union would have given them.

In this model, every design choice that is currently a liability becomes an asset:

| Today (liability) | In the remittance model (asset) |
| --- | --- |
| CPINR — an unbacked token you invented | **USDC on Stellar** — regulated, redeemable, someone else's compliance problem |
| The relayer sponsors fees so users don't hold XLM | Exactly right — senders should never touch XLM |
| Blockchain is hidden from the user | Exactly right — the sender sees "AED → INR, ₹X arrives" |
| UPI is the competitor | **UPI is the last mile you plug into** |
| No revenue | Charge 1.5–2%, undercut a 4–6% market, keep the spread |

### Three options, and my recommendation

**Option A — Inbound remittance (RECOMMENDED).** Real market, real pain, real willingness to pay, and UPI is an ally not an enemy. Hardest part is regulatory: you need a licensed partner for the INR payout leg (an authorised dealer / cross-border PA-CB). You do **not** custody, you do **not** issue a token, you do **not** touch INR yourself in v1 — you are software on top of a licensed partner.

**Option B — A self-custody Stellar wallet, positioned globally.** Keep the tech, drop the India-payments story entirely. Compete with Lobstr/Freighter. Small market, no revenue path, but it's honest and shippable. This is what the code is *closest* to today.

**Option C — White-label infra.** Sell the relayer + sponsored-account + fee-abstraction stack as an SDK to other Stellar builders. You've genuinely solved a fiddly problem. Tiny market, but a real one, and it needs zero licences.

Take **A**, with **B** as the pilot vehicle while you find a licensed partner. A is the only path with a business at the end of it.

---

## 4. Target architecture (v2)

The core structural change: **the client stops being a source of truth about money.**

```
Sender (Gulf/US/EU)                     C-Pay Backend                     Recipient (India)
─────────────────────                   ─────────────                     ─────────────────
  App                                                                       (no app needed)
   │  1. KYC (partner SDK)                                                        │
   │  2. Pay AED/USD ───────────────►  On-ramp partner                            │
   │                                          │                                   │
   │                                          ▼                                   │
   │                                    USDC on Stellar                           │
   │                                          │                                   │
   │                                          ▼                                   │
   │                                 Licensed INR payout partner ─── UPI/IMPS ───►│
   │                                          │                                    (bank a/c)
   │  ◄──── 3. Push notification ─────────────┘
   │        "₹18,240 delivered"

              Ledger Service (authoritative)
              ├─ Horizon ingest → transactions table (server-write only)
              ├─ Idempotent transfer state machine
              └─ Reconciliation vs partner + chain
```

Concrete changes from today:

1. **Delete CPINR.** Use USDC on Stellar (public network, Circle-issued). You are not in the token-issuance business.
2. **Delete the Soroban contract.** It secures nothing. If you later need on-chain escrow for the payout leg, design it then, for that, with an audit.
3. **Ledger service replaces client writes.** A worker ingests Horizon payments for accounts you know about and writes `transactions`. Clients get `SELECT` only. `INSERT`/`UPDATE` policies on `transactions` are dropped entirely.
4. **Server-side limits.** Move `securityLimits.ts` logic into Postgres/relayer, keyed on `auth.uid()`. Client-side limits in AsyncStorage are theatre.
5. **Bind auth identity to wallet.** The relayer must check `req.auth.sub` owns the `accountId` it is sponsoring/funding. It currently does not, at all.
6. **The relayer gets an idempotency table, not a Map.** (You already have the `relayer_idempotency_keys` table in the schema — it's unused.)
7. **Custody plan.** Sponsor/distribution/admin secrets are in `.env` on a single box. Before any real money: HSM or KMS, multisig on the issuer-equivalent, rotation runbook.

---

## 5. Removing the merchant module

You said to remove it, and it's the right call — it's the part most tangled with UPI competition, it carries the worst bug in the app (see B-2 below), and in a remittance product there is no merchant. The recipient has a bank account, not a QR code.

**Delete outright:**
```
App/src/screens/MerchantRegistrationScreen.tsx
App/src/screens/MerchantDashboardScreen.tsx
App/src/screens/MerchantQRGeneratorScreen.tsx
App/src/screens/MerchantGlobalQRScreen.tsx
App/src/screens/MerchantTransactionsScreen.tsx
App/src/services/merchant.ts
```

**Edit (merchant refs are entangled, don't just sed them):**

| File | Work |
| --- | --- |
| `App/src/navigation/index.tsx` | Drop 5 imports, 5 route types, 5 `<Stack.Screen>` entries |
| `App/src/screens/PaymentConfirmScreen.tsx` | 71 refs — the merchant-intent path is woven through the payment flow. Collapse to a single P2P path. |
| `App/src/screens/SendMoneyScreen.tsx` | 31 refs — merchant lookup/branching |
| `App/src/screens/ProfileScreen.tsx` | 37 refs — "Become a merchant" entry points |
| `App/src/utils/qrCode.ts` | 19 refs — merchant QR payload variants |
| `App/src/services/blockchain.ts` | Remove `registerContractMerchant`, `createPaymentIntent`, and the `merchantId` branch in `sendPayment` |
| `App/src/utils/cpayId.ts` | Remove `getCurrentMerchantCPayId` |
| `App/src/components/TransactionDetailModal.tsx`, `TransactionItem.tsx`, `ScanScreen.tsx`, `PaymentSuccessScreen.tsx`, `paymentFailure.ts`, `types/index.ts`, `storage.ts` | Strip merchant fields/branches |

**Relayer** (`server.js`, 54 refs): remove `/contract/merchants/register`, `/payments/intents/prepare`, `/payments/intents/submit`, the `intentId` branch of `/payments/submit`, and all contract-intent helpers. This deletes roughly half the file and every Soroban dependency.

**Schema:** drop `merchants`, `merchant_qr_codes`, `get_public_merchant_by_id`, `get_public_merchant_by_address`, `get_own_merchant_by_wallet`, `refresh_merchant_totals`, `update_merchant_totals_from_transaction` + trigger; drop `transactions.merchant_id` / `merchant_name`; drop `'merchant'` from the `transaction_type` CHECK.

**Contract:** the whole thing goes (see §4.2). If you keep it for now, `register_merchant`, `set_merchant_account`, `set_merchant_active`, `merchant` are all dead.

⚠️ Write a migration, don't just drop tables — six pilot users have rows. And ship an app update *before* the schema change, or old builds will crash on missing RPCs.

---

## 6. Bug register

Verified against the code. Ordered by how much they'd cost you.

### P0 — must fix before anyone touches real money

**B-1 · Anyone can forge transaction history.**
`App/supabase_schema.sql:448`. Covered in §Gap 3. Any authenticated user can INSERT a `success` transaction naming themselves as sender or recipient, with an arbitrary amount and hash. Merchant revenue totals are derived from this table by trigger, so they are attacker-controlled too.
*Fix:* revoke client INSERT/UPDATE on `transactions`; populate server-side from Horizon.

**B-2 · Merchant registration silently destroys the user's cloud backup.**
`MerchantRegistrationScreen.tsx:141` → `auth.ts:342` calls `supabase.auth.signInWithOtp({ email: businessEmail, shouldCreateUser: true })`, then `auth.ts:382` verifies it. **This replaces the logged-in Supabase session** with a session for the business email. `auth.uid()` changes. And `wallet_backups` is `UNIQUE(auth_user_id)` (`supabase_schema.sql:127`) with RLS scoped to `auth.uid()` — so after registering as a merchant with a different email, `getCloudWalletBackup()` returns nothing and **the user's only wallet recovery path is gone**. Their `users` row is now owned by a different auth user too.
*Fix:* removing the merchant module removes this. If you keep any second-email flow, it must use a verification method that does not mint a session.

**B-3 · Idempotency keys are not idempotent.**
`blockchain.ts:245` and `blockchain.ts:302` build keys as `` `add-money-${pubkey}-${Date.now()}` `` and `` `payment-${...}-${Date.now()}` ``. The timestamp guarantees a fresh key on every attempt, so the relayer's idempotency cache (`server.js:381`, `server.js:451`) can never match. A double-tap, or a client retry after the 12s timeout while the server is still submitting, sends the payment **twice**.
*Fix:* generate the key once per payment *intent* (UUID held in component state) and reuse it across retries.

**B-4 · Add Money can be drained.**
`server.js:463–508`. Two problems. (a) The cooldown is check-then-act with no lock — fire two requests concurrently and both pass. (b) The cooldown is keyed on **wallet address**, and a user can create unlimited wallets under one auth account. `req.auth.sub` is available and unused.
*Fix:* key the cooldown on `auth.uid()`, and enforce it with a unique DB constraint or `SELECT … FOR UPDATE`, not a `Map`.

**B-5 · The relayer never checks that you own the account you're asking it to fund.**
`/accounts/prepare` (`server.js:156`), `/add-money` (`server.js:439`), `/payments/submit` (`server.js:376`) all take an `accountId` from the request body and never compare it to `req.auth.sub`. Any authenticated user can make you sponsor account creation for arbitrary Stellar accounts — each one costs the sponsor `STARTING_BALANCE` (1.5 XLM) plus reserves. Rate limiting is per-IP only.
*Fix:* bind `auth.uid()` → wallet address server-side and reject mismatches.

**B-6 · A 6-digit PIN protects the wallet, with weak KDF parameters.**
`wallet.ts:19-20`: `PIN_KDF_ITERATIONS = 20000` (reduced from a legacy 120000), `WALLET_KDF_ITERATIONS = 80000`. The PIN keyspace is 10⁶. PBKDF2-SHA256 at 80k iterations is a few ms on commodity GPU hardware — the entire keyspace is exhaustible in minutes if the SecureStore blob is ever extracted. There is also **no failed-attempt lockout or wipe** anywhere in `wallet.ts`.
*Fix:* attempt counter with exponential backoff + wipe-after-N; move to Argon2id or hardware-backed key wrapping; treat the PIN as a *convenience* factor and require biometrics/hardware keystore for the actual key.

### P1 — will embarrass you in front of users

**B-7 · The C-Pay ID is unstable and collision-prone.**
`cpayId.ts:18-28` uses a 32-bit FNV-1a hash of the wallet address as the ID suffix — for an identifier people are supposed to *pay to*. Worse, `getCurrentUserCPayId()` (`cpayId.ts:124-138`) regenerates the ID whenever the underlying email changes and overwrites it in the DB. **A payment handle that changes is not a payment handle.** Old QR codes stop resolving. And since `users.cpay_id` is `UNIQUE`, a collision makes the UPDATE fail — and the error is discarded.
*Fix:* assign an ID once, at account creation, from a collision-checked namespace. Never regenerate. Never derive it from mutable data.
*Status: fixed (#161).* The database assigns the ID once (`allocate_cpay_id` + `cpay_id_reservations` in `20261022000001_stable_cpay_ids.sql`). `20261121000002_private_cpay_id_handles.sql` makes new handles random (`user<hex>@cpay<hex>`), so they no longer leak the email. It also retries collisions instead of dropping them, freezes existing IDs (`NOT NULL`, any change raises), and the App only reads the ID (enforced by `cpayIdClientWrites.test.ts`).

**B-8 · The production relayer will time out on every cold start.**
`app.json` points the app at `https://c-pay-mp8i.onrender.com`. Render's free tier spins down after ~15 minutes idle and takes 30–60s to wake. `blockchain.ts:58` sets `RELAYER_TIMEOUT_MS = 12000`. **The first payment after any quiet period always fails** with "Payment service is taking too long."
*Fix:* paid instance or a keep-alive ping; and a longer timeout with a proper "waking up" state in the UI.

**B-9 · There is no dark mode — and the README says there is.**
Zero occurrences of `useColorScheme` / `Appearance` / `colorScheme` in the entire app. `theme.ts` has only a light palette (`primaryDark` etc. are just darker *shades*, not a dark theme). Meanwhile `app.json` declares `"userInterfaceStyle": "automatic"`, telling the OS the app handles both. It does not.
*Fix:* either build it or set `"userInterfaceStyle": "light"`. See also §8.

**B-10 · Client-side limits are decorative.**
`securityLimits.ts` stores limits in AsyncStorage, **fails open** on any error (lines 75, 143), and resets when the user clears app data. It also disagrees with the server: `MAX_AMOUNT_PER_TRANSACTION = '1000'` vs the relayer's `MAX_PAYMENT_AMOUNT = 100000`.
*Fix:* server-side, keyed on user identity.

**B-11 · The Soroban contract verifies nothing.**
`lib.rs` — `confirm_intent` accepts a `payment_hash` from the relayer and stores it. It never checks the payment happened. `config.token` is stored and never used. Intents live in `temporary()` storage. It provides no security property that the relayer doesn't already have.
*Fix:* delete it. (§4.2)

**B-12 · Non-atomic PIN change can brick a wallet.**
`wallet.ts:212` — `changeWalletPin` deletes the salt, then re-encrypts, then rewrites the verifier. A crash between steps leaves the wallet encrypted under the new PIN with no valid verifier: permanent local lockout, recoverable only via cloud backup.

**B-13 · Errors are swallowed into `false`/`null`.**
`verifyPin` (`wallet.ts:206`) and `getWallet` (`wallet.ts:145`) catch everything and return `false`/`null` — so a transient SecureStore failure is indistinguishable from a wrong PIN. Users get told their correct PIN is wrong.

**B-14 · Unauthenticated balance enumeration + infra disclosure.**
`GET /health` (`server.js:89`) publishes your sponsor and distribution **public keys and balances** to anyone. `GET /account/:id/balance` and `/status` (`server.js:130`, `:144`) are unauthenticated — anyone can look up any account's CPINR balance.

### P2 — cleanup

- **B-15** · 211 `console.log`/`error`/`warn` calls ship in the production bundle, several logging transaction payloads and Supabase errors.
- **B-16** · **`App/src/constants/config.ts` is imported by zero files.** It's a dead second design system exporting a *different* `COLORS.primary` (`#667eea`) than the real `theme.ts` (`#2563EB`). Delete it.
- **B-17** · Dead code: `utils/simCard.ts`, `utils/resetApp.ts`, the entire phone-OTP path in `auth.ts` (`sendOTP`, `verifyOTP`, `sendPhoneOTP`, `verifyPhoneOTP`), and the `relayer_idempotency_keys` table (schema declares it; relayer uses an in-memory `Map`).
- **B-18** · Relayer in-memory state (`idempotencyCache`, `addMoneyCooldowns`, `contractIntentCache`) breaks on restart and on any second instance. `addMoneyCooldowns` is never evicted — unbounded growth.
- **B-19** · `storage.ts:239` interpolates the wallet address straight into a PostgREST `.or()` filter string. Low risk today (addresses are validated Stellar keys) but it's a filter-injection pattern waiting for a less-validated input.
- **B-20** · ~2.3MB of PNGs in the bundle: `default-profile-image-cryptopay.png` (1.0MB), `default-merchant-image-cryptopay.png` (880KB), `cpay_logo.png` (396KB) — for two placeholders and a logo.
- **B-21** · `ProfileScreen.tsx` is 1,470 lines; `PaymentConfirmScreen.tsx` mixes limit checks, contract intents, monitoring, and navigation. These will fight every future change.

---

## 7. Branding

### 7.1 The logo has to change, and not for taste reasons

Look at `App/assets/cpay_logo.png` and note what's in the middle of it: **a Bitcoin coin. ₿.**

C-Pay does not run on Bitcoin. It runs on **Stellar**. The logo is *factually wrong about its own product*.

And it's worse than a factual error, because it's an own-goal on positioning. Your entire thesis — the first line of the README — is *"no crypto knowledge required,"* hide the blockchain, make it feel like UPI. Then the app icon is the single most recognisable crypto-speculation symbol on earth. To a mainstream Indian user in 2026, a Bitcoin coin on a payments app says *scam, volatility, 30% tax, my cousin lost money*. You are spending your first impression buying the exact association the product exists to avoid. In a remittance pivot, where you are asking a construction worker in Sharjah to trust you with a month's wages, this is fatal.

Beyond that, the mark is technically broken as an app icon:

| Problem | Consequence |
| --- | --- |
| **No alpha channel** (verified: `PNG 1024x1024, 8-bit/color RGB`) | Hard white box. It cannot sit on any dark surface. |
| Used as `android.adaptiveIcon.foregroundImage` (`app.json`) | Adaptive icons mask the foreground into a circle/squircle and require the mark inside a **66% safe zone with transparent padding**. A full-bleed opaque square gets clipped — you get a white circle with the logo's edges sliced off. |
| **Wordmark baked into the icon** | "C-Pay" is unreadable at 48dp. Icons carry a *mark*, never a lockup. |
| One 1024px raster reused for icon + splash + adaptive foreground + favicon + README | Nothing is optimised for anything. |
| 4+ hues (blue, green, gold, orange) + gloss + bevel + drop shadow | Reads as 2012 skeuomorphism, and as AI-generated — which is now itself a trust signal, and not a good one. |

### 7.2 Direction for the new mark

**Concept: the C *is* the transfer.** The letterform C is an arc — an incomplete circle, an opening. Money moves through the gap. That's the whole idea: a single geometric C, drawn as a path with a directional terminal, suggesting movement from one side to the other. No coin. No circuit board. No blockchain iconography of any kind.

Constraints for whoever draws it (you, a designer, or a tool):

- **One colour + white.** Must survive being printed on a receipt in black ink.
- **Geometric, not illustrated.** Constructed from circles and a single stroke weight.
- **Legible at 16px.** Test it at favicon size *first*, not last.
- **No gradient in the primary mark.** A gradient can exist as a secondary brand expression, never in the icon.
- **No wordmark inside the icon.** The lockup (mark + "C-Pay" set in a real typeface) is a *separate* asset.
- **Nothing that reads as "crypto."** No coins, no chains, no nodes, no ₿, no Ξ.

**Palette — pick one primary and delete the rest.** You currently have three competing "brand" colours in the repo:
- `constants/theme.ts` → `#2563EB` (the one actually used, in 38 files)
- `constants/config.ts` → `#667eea` (dead file, B-16)
- `app.json` splash + adaptive background → `#6366f1`

Standardise on **`#2563EB`**, propagate it to `app.json`, delete `config.ts`. One token, one source of truth.

### 7.3 The asset set you actually need

You currently have one PNG doing seven jobs. Produce these from a single **SVG master**:

| Asset | Spec | Notes |
| --- | --- | --- |
| `logo-master.svg` | Vector | Source of truth. Everything else is generated from this. |
| `icon.png` | 1024×1024, opaque | iOS app icon. iOS *wants* the background baked in — no alpha, no rounded corners (iOS masks). |
| `adaptive-icon-foreground.png` | 1024×1024, **transparent**, mark within centre 66% | Android. This is the one that's broken today. |
| `adaptive-icon-background.png` *or* solid `#2563EB` | 1024×1024 | Android layer 2. |
| `monochrome-icon.png` | 1024×1024, transparent, single-colour | Android 13+ themed icons. Missing entirely today. |
| `splash.png` | ~1284×2778, transparent mark on brand bg | Not the same file as the icon. |
| `favicon.ico` / `favicon.png` | 32/48px | Redrawn for legibility at size, not downscaled. |
| `logo-lockup-light.svg` / `-dark.svg` | Vector | Mark + wordmark, for README/web/pitch deck. Two versions so it works on both backgrounds. |
| `logo-mono.svg` | Vector, single colour | Invoices, receipts, partner docs, print. |

And fix the two ~1MB placeholder PNGs (`default-profile-image-cryptopay.png`, `default-merchant-image-cryptopay.png`) — an SVG initial-avatar generated at runtime is ~0KB and looks better.

---

## 8. Honesty debt in the README

This one matters more than it looks, because you're about to show this repo to investors, judges, or employers — and it's the kind of thing that, once caught, poisons everything else you've said.

**The "User Feedback Implementation" table cites commits that don't do what it claims.**

| Feedback | README cites | What that commit actually is |
| --- | --- | --- |
| "Make the dark theme default…" (Arka Dash, 28 Apr) | [`a192c5f`](https://github.com/soumen0818/C-Pay/commit/a192c5f) | *"Full project setup and contact deploy"* — the **initial project import**, dated **25 April**, three days **before** the feedback was given. It adds no dark mode; the app still has none (B-9). |
| "There is no withdrawal option." (Shampa Das) | [`b701f6f`](https://github.com/soumen0818/C-Pay/commit/b701f6f) | *"add details readme with screenshort"* — a **README + screenshots** commit. No withdrawal feature. |

I don't think this was intended as deception — it looks like the table was filled in to look complete. But a reviewer who clicks one link finds a commit that predates the feedback it supposedly addresses, and from that moment every other claim in a 1,674-line README is suspect.

**Fix it directly:** change those cells to `Planned` / `Not implemented`. "We heard this and haven't built it yet" is a completely respectable thing for a pilot to say. A broken citation is not.

While you're there, the README also claims a Soroban contract as a core architectural component when it secures nothing (B-11), and describes a merchant/KYS/fiat-bridge roadmap that §2 says shouldn't be built.

---

## 9. Sequenced plan

**Phase 0 — Stop the bleeding (1–2 weeks)**
Fix B-1, B-3, B-4, B-5 (the four that let someone take money or forge a record). Fix the README citations (§8). Do this even if you pivot tomorrow — the repo is public.

**Phase 1 — Subtract (2–3 weeks)**
Remove merchant (§5). Delete the Soroban contract. Delete `config.ts` and the dead phone-OTP paths. The app should get *smaller*. A tight P2P Stellar wallet is a better artefact than a sprawling half-built payment network.

**Phase 2 — Rebuild trust (3–4 weeks)**
Server-authoritative ledger (Horizon ingest → `transactions`, client read-only). Server-side limits. Auth↔wallet binding. Real idempotency table. Relayer off the free tier (B-8).

**Phase 3 — Rebrand (parallel, 1–2 weeks)**
New mark (§7.2). Full asset set (§7.3). One brand colour. Retire the Bitcoin coin.

**Phase 4 — Repoint (ongoing)**
Rewrite the pitch around inbound remittance. Swap CPINR → USDC on Stellar testnet, then public. **Start the licensed-partner conversation now** — it is the long pole, it takes months, and everything else is worthless without it. Nothing touches real money until a partner is signed.

**What to say about C-Pay in the meantime:** not *"a UPI competitor on blockchain"* — that invites the comparison you lose. Say: *"a self-custody Stellar wallet that abstracts away fees, trustlines and seed phrases, piloted with real users, being pointed at the India inbound-remittance corridor."* That's true today, it's technically impressive, and it's a business.

---

## Sources

- [NPCI UPI product statistics](https://www.npci.org.in/product/upi/product-statistics) · [UPI May 2026 record — ANI](https://www.aninews.in/news/business/upi-hits-new-high-in-may-2026-with-232-billion-transactions-worth-rs-299-trillion-npci-data-shows20260602155337/)
- [Crypto taxation in India — ClearTax](https://cleartax.in/s/cryptocurrency-taxation-guide) · [Crypto tax guide — CoinDCX](https://coindcx.com/blog/cryptocurrency/crypto-tax-guide-india/) · [India crypto regulation guide 2026 — CoinGabbar](https://www.coingabbar.com/en/crypto-blogs-details/india-crypto-regulation-guide-ban-taxes-vda-rules-2026)
- [Personal remittances received, India — World Bank](https://data.worldbank.org/indicator/BX.TRF.PWKR.CD.DT?locations=IN) · [India–GCC remittance corridors 2026](https://www.mahadmanpowers.co.in/research/india-to-gcc-remittance-corridors-2026/report.pdf)
- [Stablecoins & cross-border payments report 2026 — OpenFX](https://www.openfx.com/stablecoins-cross-border-payments-report-2026) · [Stablecoins in emerging markets — Tazapay](https://tazapay.com/guides/stablecoins-cross-border-payments-emerging-markets)
