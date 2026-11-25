# Contributing to C-Pay

Thanks for helping improve C-Pay. This repo contains a mobile app, a Stellar relayer, and Stellar asset scripts, so contributions should be careful about user safety, payment correctness, and clear UX.

## Code of Conduct

This project follows the [Contributor Covenant Code of Conduct](CODE_OF_CONDUCT.md). By participating, you agree to uphold it.

## Project Areas

| Directory | Description |
| --- | --- |
| `App/` | Expo React Native mobile wallet and merchant app |
| `relayer-service/` | Express service for sponsored setup, payments, and Add Money coordination |
| `Blockchain/` | Stellar asset scripts and blockchain helper tests |
| `public/` | Screenshots and demo assets used by documentation |

## Before You Start

1. **Open an issue first** for large changes. Small fixes (typos, obvious bugs) can go straight to a PR.
2. Keep changes scoped to one feature, bug, or refactor.
3. Do not commit real secrets, Stellar secret seeds, service-role keys, production `.env` files, or private user data.
4. Treat wallet, relayer, and transaction changes as security-sensitive.

## Local Setup (Clone to Run)

To contribute code, you'll need to run both the mobile app and the backend relayer locally.

### 1. Prerequisites
- **Node.js**: v18+ 
- **Git**
- **Supabase Account**: You need a free Supabase project to store profiles and transactions.
- **Expo Go** app on your iOS/Android device, or an emulator.

### 2. Supabase Project Setup

The files in `supabase/migrations/` are the only database schema source. Do not
apply a separate schema file or the migrations from another directory.

Provision a fresh local database with one command from the repository root:

```bash
supabase start
```

This starts the local Supabase stack and applies the complete root migration
chain in filename order. Obtain the local Project URL, anon key, and service-role
key from the command output.

#### Database Migration Guidelines

- **Never edit applied migrations**: Migrations are strictly append-only. Because migrations have already run in pilot and production environments, applied migrations must **never** be edited, renamed, or deleted. Rewriting migration history causes checksum discrepancies and broken schemas across environments.
- **Forward-fix policy**: C-Pay follows a forward-fix (roll-forward) migration policy. Rollback scripts cannot safely restore dropped data, tables, or columns; any necessary schema fix, revert, or drop must be implemented by authoring a new forward-running migration.
- **Idempotency**: All migrations must be idempotent and safely re-runnable against existing databases. Use `CREATE TABLE IF NOT EXISTS`, `DROP TABLE IF EXISTS`, and always precede `CREATE POLICY` statements with `DROP POLICY IF EXISTS`.
- **Built-in UUID generation**: Use PostgreSQL's built-in `gen_random_uuid()` rather than `uuid_generate_v4()` from `uuid-ossp` for primary keys and UUID column defaults.
- **Privilege & RLS Lockdown**: All client-facing tables must enable Row Level Security (RLS). Explicitly revoke privileges from `anon` and `authenticated` roles, granting only least-privilege operations.

### 3. Environment Configuration
Clone the repo and install dependencies:
```bash
git clone https://github.com/soumen0818/C-Pay.git
cd C-Pay

cd App && npm install
cd ../relayer-service && npm install
cd ../Blockchain && npm install
```

Copy the env files:
```bash
cp App/.env.example App/.env
cp relayer-service/.env.example relayer-service/.env
```

**Edit `relayer-service/.env`**:
- Set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` to your Supabase project credentials.
- Set `STELLAR_NETWORK=testnet`

**Edit `App/.env`**:
- Set `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY`.
- Set `EXPO_PUBLIC_STELLAR_RELAYER_URL=http://YOUR_LOCAL_IP:3000` (Use your local network IP, e.g., `192.168.1.5`, not `localhost` so your phone can reach it).

### 4. Running the Relayer Locally
Start the backend service that handles Stellar transactions:
```bash
cd relayer-service
npm start
```
The relayer should log that it is listening on port 3000.

### 5. Running the App
In a new terminal:
```bash
cd App
npx expo start
```
Scan the QR code with the Expo Go app.

### 6. Funding a Testnet Account
When you create a wallet in the app, the relayer will automatically fund it using the Stellar Friendbot on testnet. 
If you need manual testnet XLM for testing merchant accounts, you can use the [Stellar Laboratory](https://laboratory.stellar.org/#account-creator?network=test).

### 7. "You're Set Up Correctly When..."
You know your local environment is perfectly configured when:
1. You can launch the app and create a new wallet.
2. The relayer logs show successful Friendbot funding.
3. Your Supabase `profiles` table shows a new row for your created user.
4. You can send a payment and see it reflected in both the app UI and your Supabase `transactions` table.

## Running Checks

Run only the checks relevant to your change:

### Mobile App

```bash
cd App
npx tsc --noEmit
npx expo install --check
```

### Relayer

```bash
cd relayer-service
node --check server.js
npm test -- --passWithNoTests --runInBand
```

### Blockchain

```bash
cd Blockchain
npm test -- --runInBand
```

## Mobile UX Guidelines

- Keep screens simple, readable, and safe for payment decisions.
- Prefer reusable components from `App/src/components/` over one-off UI.
- Use the shared theme in `App/src/constants/theme.ts`.
- Make payment, recovery, export-key, and merchant actions explicit and hard to misread.
- Support small screens, large text, screen readers, and clear loading/error states.
- Avoid adding "coming soon" buttons unless the issue explicitly asks for a placeholder.

## Security Guidelines

- Never expose Stellar `S...` secret seeds in app code, docs, screenshots, logs, or examples.
- Keep Supabase service-role keys only in backend environments.
- Bind authenticated users to their own wallet and merchant records in backend changes.
- Do not trust client-written transaction status for balances, receipts, or merchant analytics.
- Add tests for payment validation and relayer authorization when changing those paths.

## Pull Request Process

1. Use the [PR template](.github/pull_request_template.md) when opening a pull request.
2. Describe the user problem and the implemented solution.
3. List the main files changed.
4. Include screenshots or short recordings for UI changes.
5. Include test output, or explain why tests were not run.
6. Note any migration, environment, or deployment steps.
7. Confirm no secrets or private user data were added.
8. A maintainer will review your PR. Small fixes may be merged quickly; larger changes require at least one approval.

## Documentation

Update documentation when a change affects setup, environment variables, contract IDs, public API endpoints, user flows, screenshots, or production notes. Keep public docs privacy-safe and avoid publishing real pilot user information.

## Getting Help

- **Issues**: Use GitHub [issues](https://github.com/soumen0818/C-Pay/issues) for bug reports and feature requests.
- **Discussions**: Use GitHub [discussions](https://github.com/soumen0818/C-Pay/discussions) for questions and general conversation.
- **Security**: See [SECURITY.md](SECURITY.md) for reporting vulnerabilities privately.
