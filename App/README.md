# C-Pay mobile app

React Native/Expo self-custody wallet for Stellar USDC.

## Asset configuration

The app accepts Circle-issued USDC only. Testnet defaults to Circle's canonical issuer:

```env
EXPO_PUBLIC_STELLAR_NETWORK=testnet
EXPO_PUBLIC_USDC_ASSET_ISSUER=GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5
```

Amounts are signed with at most seven fractional digits. The UI displays between two and seven fractional digits and labels balances explicitly as USDC.

See [`../docs/usdc-migration.md`](../docs/usdc-migration.md) for asset and pilot-user migration decisions.

## Secret-key export safeguards

The Security Center's key export (`src/screens/SecurityCenterScreen.tsx`) is
hardened as follows (#162):

- **Fresh authentication every time.** Export calls
  `getFreshlyAuthenticatedWallet()` (`src/utils/biometric.ts`), which always
  shows a biometric or PIN prompt. It never reuses the 15-minute unlock session.
- **Clipboard auto-clear.** A copied key is wiped from the system clipboard
  after 45 seconds, as soon as the app goes to the background, or when the
  user leaves the Security Center (`src/utils/secureClipboard.ts`). The UI
  tells the user this.
- **Screen-capture protection.** While a key is visible,
  `src/utils/screenCapture.ts` uses the `expo-screen-capture` native module to
  block screenshots and recording on Android. On iOS it blocks recording and
  warns after a screenshot. The module is resolved optionally: if it is not
  linked, the modal shows a "protection unavailable" warning instead. To
  enable protection, run `npx expo install expo-screen-capture` and rebuild
  the dev client or EAS build.
- If C-Pay leaves the foreground, the key modal closes.
