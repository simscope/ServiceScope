# Meta connection foundation (Phase 5B)

## Decision

ServiceScope uses the official Facebook Login for Business authorization-code path for the initial combined provider, identified internally as `meta-facebook-login`. The Business Login configuration is selected with `config_id`; the application does not send a browser-authored permission list. This path discovers Facebook Pages the signed-in Meta user can manage and the optional Instagram Professional account linked to each Page.

Instagram Login is intentionally not used for this initial provider because the product needs a single company authorization that starts with Facebook Page ownership and then discovers the linked Instagram Business or Creator account. Publishing remains outside this phase.

## Repository audit

Reusable components:

- `app_current_session()` remains the server-authoritative session resolver.
- `can_manage_company(uuid)` remains the company authorization contract for active Managers/Admins and the existing platform-owner policy.
- The shared `canManageCompanySettings` resolver remains the browser mount boundary for restricted Settings and callback completion. It grants the same company Admin/Manager capability as the server contract and preserves platform-owner access.
- `supabaseFunction` remains the authenticated browser-to-Edge transport.
- Existing Service Role key resolution and normalized telemetry patterns are reused inside the Edge boundary.
- Existing `audit_events` is reused for safe lifecycle events.

Components intentionally not reused:

- Mailbox OAuth state is not suitable because it is not hashed, one-time, actor-bound, or atomically consumed.
- Mailbox token byte encoding is not encryption and is not used for Meta authorization material.
- The unauthenticated mailbox provider callback is not used. Meta returns to an application callback route, which immediately removes its query and calls a JWT-protected Edge action.

Missing components added by this phase:

- dedicated social connection and one-time OAuth state tables;
- atomic consume, replacement, disconnect, and retention-cleanup RPCs;
- Edge-only AES-256-GCM envelope utility with authenticated context;
- Meta provider adapter and safe discovery/health contracts;
- restricted Social connections UI and callback page;
- regression, isolated SQL security, source, and bundle scans.

## Official Meta contract

The authorization contract was checked on 2026-07-31 against Meta's official [Facebook Login for Business documentation](https://developers.facebook.com/docs/facebook-login/facebook-login-for-business). That documentation establishes `config_id` as the Business Login configuration selector and recommends omitting `scope` for User access-token configurations.

`META_GRAPH_API_VERSION` is required and must equal `v25.0`. No `latest` or fallback version is accepted. The version decision was checked on 2026-07-31 against Meta's official Business SDK v25 releases, including the official Node SDK v25.0.1 release published on 2026-03-30:

- <https://github.com/facebook/facebook-nodejs-business-sdk/releases/tag/v25.0.1>
- <https://github.com/facebook/facebook-python-business-sdk/releases/tag/25.0.1>

The pinned version must be reviewed again before deployment or App Review if Meta changes the Page or Instagram discovery contracts.

The Meta Business Login configuration assigns only:

- `pages_show_list`
- `pages_read_engagement`
- `instagram_basic`

The application does not add a `scope` query parameter. Page/Instagram publishing, messaging, comments, ads, business-management, and Page-metadata management permissions are intentionally deferred to separate reviewed work.

## OAuth sequence

1. An authenticated company settings manager or platform owner selects **Connect Meta**.
2. `meta-social-connection:start` resolves `app_current_session`, validates `can_manage_company`, allowlists the return path, performs bounded expired-state cleanup, generates at least 32 random bytes, and stores only the SHA-256 state hash.
3. The state row is actor-, company-, provider-, redirect-, and return-path-bound and expires within ten minutes.
4. The browser navigates to `https://www.facebook.com/v25.0/dialog/oauth` with exactly `client_id`, `redirect_uri`, `config_id`, `response_type=code`, `override_default_response_type=true`, and `state`.
5. Meta returns to `/auth/meta/callback` with `code`, `state`, or safe provider error fields.
6. The callback captures those fields only in module memory and immediately calls `history.replaceState` to remove the query.
7. An authenticated callback sends the response to `meta-social-connection:complete`; the browser never exchanges the code and never receives an authorization token.
8. The server atomically consumes the state before code exchange. Wrong actor/company/provider/redirect, expiry, and replay fail closed. Every terminal completion path deletes the exact consumed state row.
9. The server derives the typed return destination from the consumed row. The browser never supplies a destination, and the callback returns to the existing Social connections view without a dead hash route.

No callback value is written to local storage, session storage, DOM text, logs, telemetry, or error details.

## Asset selection

After code exchange and optional supported long-lived exchange, the server requests the granted-permission list and Page discovery. `/me/accounts` uses cursor-only pagination, follows no provider-supplied URL, permits at most five Page requests and 100 unique Pages, deduplicates by Page ID, and performs at most one retry for an idempotent GET on a transient network/5xx failure. Each Page is normalized to safe metadata:

- Page ID and name;
- permitted task names;
- optional linked Instagram account ID, username, and Business/Creator type;
- Facebook-only or Facebook-and-Instagram eligibility.

All authorization material remains in an encrypted pending bundle. The UI must explicitly select a Page; it never picks the first Page automatically. Selection is accepted only when the Page is part of the actor/company-bound discovery result. A Facebook Page without a linked Instagram Professional account is valid as Facebook-only.

## Encryption envelope

Tokens exist only in server memory and in an AES-256-GCM envelope with exactly these fields:

```json
{
  "schemaVersion": "encrypted-social-token-v1",
  "algorithm": "AES-GCM",
  "keyVersion": 1,
  "purpose": "meta-connection",
  "iv": "base64url value",
  "ciphertext": "base64url value"
}
```

`META_TOKEN_ENCRYPTION_KEY_V1` must decode to exactly 256 bits; malformed or wrong-length keys leave the integration unconfigured. Every encryption receives a new random 96-bit IV. Pending envelopes use purpose `meta-pending` and authenticated context containing company, actor, OAuth-state row, provider, and redirect URI. Final envelopes use purpose `meta-connection` and authenticated context containing company, connection, provider, and Page. Context swaps, missing context, authentication failure, malformed envelopes, and unknown key versions fail closed as reauthorization. The envelope, IV, ciphertext, keys, and plaintext authorization material are never returned to the browser or telemetry.

## Token lifecycle

- OAuth completion stores a short-lived pending encrypted bundle and safe discovered assets.
- Explicit asset selection uses one transaction to serialize on the company, revoke and clear every prior active token for the provider, insert the selected connection, delete every company/provider pending OAuth row across actors, and write the audit event.
- A partial unique index permits at most one non-revoked provider connection per company.
- The final encrypted bundle contains only the server-required user/Page authorization material.
- Expiry is exposed only as `valid`, `expired`, or `unknown`.
- Status/start perform bounded cleanup of expired company/provider OAuth states; valid and other-tenant states remain untouched.
- There is no background refresh, cron, worker, or automatic provider call.

## Health check

Health runs only from **Check connection**. It decrypts server-side, validates current permissions and Page availability, validates the linked Instagram account when selected, updates safe status timestamps/codes, and returns safe metadata with the actual provider-attempt count. Token invalidity, missing permissions, unavailable selected Page, linked-Instagram mismatch, expiry, and decrypt/AAD failure require reauthorization. Rate limits, timeouts, provider unavailability, and internal persistence failures do not overwrite a usable connection as `needs_reauthorization`. Idempotent GETs permit at most one bounded retry; code exchange does not retry automatically.

## Disconnect

Disconnect requires explicit confirmation and is company-local. One database transaction clears local encrypted authorization material, marks the selected connection revoked, deletes every company/provider pending state across actors, and writes the audit event. It performs no provider request, so disconnect remains available when provider configuration is absent or Meta is unavailable. A revoked connection cannot be health-checked and reconnect requires a new OAuth flow.

Global Meta deauthorization is intentionally deferred. It cannot be implemented safely until ServiceScope models a shared provider-authorization grant separately from company-local Page selections; revoking `/me/permissions` from one company connection could otherwise break another company that legitimately shares the same Meta user grant.

## Safe audit events

- `meta_connection_started`
- `meta_oauth_completed`
- `meta_asset_selected`
- `meta_health_checked`
- `meta_connection_needs_reauthorization`
- `meta_connection_disconnected`

Events contain company/actor linkage, a safe connection identifier where applicable, and normalized lifecycle text only. Provider payloads, request IDs, authorization values, state, secrets, and encryption data are excluded. Audit persistence failures fail the lifecycle action instead of being silently ignored.

## Environment and redirects

Server-only variables:

- `META_APP_ID`
- `META_APP_SECRET`
- `META_LOGIN_CONFIGURATION_ID`
- `META_GRAPH_API_VERSION=v25.0`
- `META_OAUTH_REDIRECT_URI`
- `META_TOKEN_ENCRYPTION_KEY_V1`

The App ID and Login Configuration ID must be numeric. The redirect URI must exactly match the Meta App configuration and the state row. Production and each Preview hostname require deliberate provider configuration; branch previews are not implicitly trusted. The app origin must also be present in the Edge CORS allowlist derived from `APP_URL`, `SITE_URL`, or `ALLOWED_ORIGINS`. None of these values is exposed through a `VITE_` variable.

## Schema validation

The migration block and the canonical `supabase/schema.sql` block are byte-normalized and compared by regression tests. The SQL security suite applies the real migration to an isolated in-memory PGlite PostgreSQL instance, exercises ACLs, state consume/replay, retention, tenant isolation, malformed envelopes, same/different Page replacement, multi-actor cleanup, local disconnect, audits, and Admin/Manager capability, then rolls back and verifies zero artifacts. It never connects to the remote Supabase project.

## App Review and rollout gates

Before live use, Meta App Review and business verification may be required for Page/Instagram discovery permissions, and the privacy policy/data-deletion URLs and valid redirect URI must be configured in the Meta App Dashboard.

This implementation does not apply its migration, deploy the Edge Function, add credentials, call Meta, or perform live OAuth. Those are separate explicit authorization gates:

1. schema/security review and remote migration authorization;
2. Edge environment configuration and deployment authorization;
3. non-paid connection-only live OAuth smoke authorization;
4. future publishing permission and implementation review in a separate PR.
