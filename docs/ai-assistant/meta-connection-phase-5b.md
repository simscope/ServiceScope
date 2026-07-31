# Meta connection foundation (Phase 5B)

## Decision

ServiceScope uses the official Facebook Login authorization-code path for the initial combined provider, identified internally as `meta-facebook-login`. This path discovers Facebook Pages the signed-in Meta user can manage and the optional Instagram Professional account linked to each Page.

Instagram Login is intentionally not used for this initial provider because the product needs a single company authorization that starts with Facebook Page ownership and then discovers the linked Instagram Business or Creator account. Publishing remains outside this phase.

## Repository audit

Reusable components:

- `app_current_session()` remains the server-authoritative session resolver.
- `can_manage_company(uuid)` remains the company authorization contract for active Managers/Admins and the existing platform-owner policy.
- Phase 5A `companySettingsAccess` remains the browser mount boundary for restricted Settings.
- `supabaseFunction` remains the authenticated browser-to-Edge transport.
- Existing Service Role key resolution and normalized telemetry patterns are reused inside the Edge boundary.
- Existing `audit_events` is reused for safe lifecycle events.

Components intentionally not reused:

- Mailbox OAuth state is not suitable because it is not hashed, one-time, actor-bound, or atomically consumed.
- Mailbox token byte encoding is not encryption and is not used for Meta authorization material.
- The unauthenticated mailbox provider callback is not used. Meta returns to an application callback route, which immediately removes its query and calls a JWT-protected Edge action.

Missing components added by this phase:

- dedicated social connection and one-time OAuth state tables;
- atomic state-consume RPC;
- Edge-only AES-256-GCM envelope utility;
- Meta provider adapter and safe discovery/health/revoke contracts;
- restricted Social connections UI and callback page;
- regression, SQL security, source, and bundle scans.

## Graph API version

`META_GRAPH_API_VERSION` is required and must equal `v25.0`. No `latest` or fallback version is accepted. The version decision was checked on 2026-07-31 against Meta's official Business SDK v25 releases, including the official Node SDK v25.0.1 release published on 2026-03-30:

- <https://github.com/facebook/facebook-nodejs-business-sdk/releases/tag/v25.0.1>
- <https://github.com/facebook/facebook-python-business-sdk/releases/tag/25.0.1>

The pinned version must be reviewed again before deployment or App Review if Meta changes the Page or Instagram discovery contracts.

## Permissions

The authorization request contains only:

- `pages_show_list`
- `pages_read_engagement`
- `instagram_basic`

Page/Instagram publishing, messaging, comments, ads, business-management, and Page-metadata management permissions are intentionally deferred to separate reviewed work.

## OAuth sequence

1. An authenticated company settings manager selects **Connect Meta**.
2. `meta-social-connection:start` resolves `app_current_session`, validates `can_manage_company`, allowlists the return path, generates at least 32 random bytes, and stores only the SHA-256 state hash.
3. The state row is actor-, company-, provider-, redirect-, and return-path-bound and expires within ten minutes.
4. The browser navigates to the official Facebook Login URL.
5. Meta returns to `/auth/meta/callback` with `code`, `state`, or safe provider error fields.
6. The callback captures those fields only in module memory and immediately calls `history.replaceState` to remove the query.
7. An authenticated callback sends the response to `meta-social-connection:complete`; the browser never exchanges the code and never receives an authorization token.
8. The server atomically consumes the state before code exchange. Wrong actor/company/provider/redirect, expiry, and replay fail closed.

No callback value is written to local storage, session storage, DOM text, logs, telemetry, or error details.

## Asset selection

After code exchange and optional supported long-lived exchange, the server requests the granted-permission list and Page discovery. Each Page is normalized to safe metadata:

- Page ID and name;
- permitted task names;
- optional linked Instagram account ID, username, and Business/Creator type;
- Facebook-only or Facebook-and-Instagram eligibility.

All authorization material remains in an encrypted pending bundle. The UI must explicitly select a Page; it never picks the first Page automatically. Selection is accepted only when the Page is part of the actor/company-bound discovery result. A Facebook Page without a linked Instagram Professional account is valid as Facebook-only.

## Encryption envelope

Tokens exist only in server memory and in the following AES-256-GCM envelope:

```json
{
  "schemaVersion": "encrypted-social-token-v1",
  "algorithm": "AES-GCM",
  "keyVersion": 1,
  "iv": "base64url value",
  "ciphertext": "base64url value"
}
```

`META_TOKEN_ENCRYPTION_KEY_V1` supplies exactly 256 bits. Every encryption receives a new random 96-bit IV. Authentication failure, malformed envelope, and unknown key version fail closed as reauthorization. The envelope, IV, ciphertext, keys, and plaintext authorization material are never returned to the browser or telemetry.

## Token lifecycle

- OAuth completion stores a short-lived pending encrypted bundle and safe discovered assets.
- Explicit asset selection creates or updates the company/asset connection and deletes the pending OAuth row.
- The final encrypted bundle contains only the server-required user/Page authorization material.
- Expiry is exposed only as `valid`, `expired`, or `unknown`.
- There is no background refresh, cron, worker, or automatic provider call.

## Health check

Health runs only from **Check connection**. It decrypts server-side, validates current permissions and Page availability, validates the linked Instagram account when selected, updates safe status timestamps/codes, and returns safe metadata. Idempotent GETs permit at most one bounded retry; code exchange and revoke do not retry automatically.

## Disconnect and revoke

Disconnect requires explicit confirmation. The server attempts the official deauthorization operation and always clears local encrypted authorization material, marks the connection revoked, and deletes actor/company pending states even when the provider revoke fails. A revoked connection cannot be health-checked and reconnect requires a new OAuth flow.

## Safe audit events

- `meta_connection_started`
- `meta_oauth_completed`
- `meta_asset_selected`
- `meta_health_checked`
- `meta_connection_needs_reauthorization`
- `meta_connection_disconnected`

Events contain company/actor linkage, a safe connection identifier where applicable, and normalized lifecycle text only. Provider payloads, request IDs, authorization values, state, secrets, and encryption data are excluded.

## Environment and redirects

Server-only variables:

- `META_APP_ID`
- `META_APP_SECRET`
- `META_GRAPH_API_VERSION=v25.0`
- `META_OAUTH_REDIRECT_URI`
- `META_TOKEN_ENCRYPTION_KEY_V1`

The redirect URI must exactly match the Meta App configuration and the state row. Production and each Preview hostname require deliberate provider configuration; branch previews are not implicitly trusted. The app origin must also be present in the Edge CORS allowlist derived from `APP_URL`, `SITE_URL`, or `ALLOWED_ORIGINS`.

## App Review and rollout gates

Before live use, Meta App Review and business verification may be required for Page/Instagram discovery permissions, and the privacy policy/data-deletion URLs and valid redirect URI must be configured in the Meta App Dashboard.

This implementation does not apply its migration, deploy the Edge Function, add credentials, call Meta, or perform live OAuth. Those are separate explicit authorization gates:

1. schema/security review and remote migration authorization;
2. Edge environment configuration and deployment authorization;
3. non-paid connection-only live OAuth smoke authorization;
4. future publishing permission and implementation review in a separate PR.
