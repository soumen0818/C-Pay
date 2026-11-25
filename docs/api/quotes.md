# Remittance quotes

`POST /quotes` returns a sender-facing quote. The endpoint requires the same
Bearer authentication as the relayer and is rate-limited with the rest of the
service.

> [!NOTE]
> The Remittance Quotes endpoints (`POST /quotes` and `POST /quotes/validate`) are feature-flagged behind `ENABLE_QUOTES_API` (defaults to `false`) until a payout partner integration is configured. Requests return `503 QUOTES_DISABLED` when the feature flag is disabled.

Request:

```json
{
  "sendAmount": "100.00",
  "sendCurrency": "USD",
  "receiveCurrency": "INR"
}
```

Response (`201`):

```json
{
  "ownerId": "usr_94b15c92",
  "sendAmount": "100.00",
  "sendCurrency": "USD",
  "amountDebited": "101.75",
  "fee": "1.75",
  "feeBps": 175,
  "fxRate": "90.12345678",
  "spreadBps": 50,
  "recipientAmount": "8967.28",
  "receiveCurrency": "INR",
  "expiresAt": "2026-09-27T12:01:00.000Z",
  "rateMovementPolicy": "The quoted recipient amount is fixed until expiresAt; settlement must reject expired quotes and obtain a new quote.",
  "signature": "8434c442b03fc1f407f63df2f1c0381748525e82d67782a149b6d73d99821266"
}
```

The FX provider is injected behind a small `getRate({ from, to })` interface.
The relayer's initial provider reads rates from `QUOTE_FX_RATES_JSON`, for
example `{"USD_INR":90.12345678}`. Fees and spread are configurable with
`QUOTE_FEE_BPS`, `QUOTE_SPREAD_BPS`, and `QUOTE_TTL_SECONDS`; no fallback rate
is used when a pair is missing. Monetary arithmetic uses integer minor units
and rounds the fee up so the sender is never undercharged. `fxRate` is returned as
a fixed-precision decimal string to avoid floating-point rounding ambiguities.

## Quote integrity and validation

Quotes are bound to the caller's authenticated user ID (`ownerId`) and signed
server-side with HMAC-SHA256 (`QUOTE_SIGNATURE_SECRET`) across canonical fields:
`sendAmount`, `sendCurrency`, `amountDebited`, `fee`, `feeBps`, `fxRate`, `spreadBps`,
`recipientAmount`, `receiveCurrency`, `expiresAt`, and `ownerId`.

Settlement must call `assertFreshForOwner` (or `POST /quotes/validate`) immediately before accepting a quote. The validation performs three checks:
1. **Freshness**: Expired quotes return `410 QUOTE_EXPIRED`.
2. **Owner binding**: Quotes presented by a different caller return `403 QUOTE_OWNER_MISMATCH`.
3. **Cryptographic integrity**: Tampered amounts, fees, rates, currencies, or forged signatures return `400 QUOTE_SIGNATURE_MISMATCH`. If quote signing is not configured on the relayer, validation fails closed with `503 QUOTE_SIGNING_NOT_CONFIGURED`.
