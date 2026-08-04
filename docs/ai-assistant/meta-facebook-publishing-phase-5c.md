# Meta Facebook publishing Phase 5C1

Phase 5C1 adds a reviewed foundation for publishing one text-only post immediately to the Facebook Page already selected in a ServiceScope Meta connection. It does not publish media, Instagram content, scheduled posts, or background jobs.

## Official Meta contract

Contract verified on 2026-08-03 against Meta's official [Page posts guide](https://developers.facebook.com/docs/pages-api/posts/), [Pages API getting started guide](https://developers.facebook.com/docs/pages-api/getting-started/), and versioned [Page feed reference](https://developers.facebook.com/docs/graph-api/reference/v25.0/page/feed/).

- Endpoint: `POST /v25.0/{page-id}/feed`.
- Authorization: Page access token in the server-side `Authorization` header.
- Content: form-encoded `message` containing the exact approved final text.
- Publishing capability: `pages_manage_posts`.
- Success: a non-empty post identifier, retained server-side only.
- Failure: the Graph error envelope is reduced to bounded numeric diagnostics and an allowlisted category.

Meta's current documentation UI may render examples using its newest default Graph version. ServiceScope remains explicitly pinned to the reviewed `v25.0` contract.

## Permission model

The existing discovery contract remains `pages_show_list`, `pages_read_engagement`, and `instagram_basic`. A connection with only those scopes remains connected and continues to pass its normal status and health contracts. Facebook publishing is a separate capability that is enabled only when the connected record also contains `pages_manage_posts`.

Users must deliberately reconnect Meta through a separately approved rollout to grant publishing access. This code does not start OAuth or change the Meta application configuration.

The Social connections panel keeps a healthy three-scope connection marked as connected while showing publishing permission guidance and a primary **Reconnect Meta** action. The existing check and disconnect actions remain available; connections that already include `pages_manage_posts` keep the standard connected controls without the reconnect warning.

The publishing reconnect uses a bounded `facebook_publishing` authorization intent. The browser cannot supply scopes or OAuth parameters: the server accepts only that exact intent, verifies an active healthy connection has the three discovery scopes and lacks `pages_manage_posts`, and then adds only `scope=pages_manage_posts` and `auth_type=rerequest` to the existing configuration-based authorization URL. Initial connection and authorization-recovery flows remain unchanged and do not use rerequest parameters.

## Human and privacy boundaries

The AI Assistant exposes publishing only inside a Facebook draft. The confirmation dialog shows the destination Page name, exact final text, character count, text-only limitation, and privacy status. Publishing remains disabled until the user checks the explicit approval control. Editing the draft invalidates that approval.

Facebook text is normalized identically in the browser and Edge runtime: CRLF and CR become LF, only outer whitespace is removed, internal LF and blank lines are preserved, and the final text must contain 1-5000 Unicode characters. TAB, NUL, other unsafe C0 controls, DEL, and unresolved `[private]` placeholders are rejected. The confirmation preview, SHA-256 input, stored `approved_message`, and provider `message` are the same normalized UTF-8 text.

The server reloads the job, customer, location, invoice, and comment context. It reuses the content engine private-values builder and privacy utility, then applies generic email, phone, street-address, access-code, invoice-number, unresolved-placeholder, and control-character checks. A privacy finding rejects the exact text; the server never silently substitutes a scrubbed version.

## Delivery safety

Each approved operation has a company-scoped UUID idempotency key. The transactional begin RPC validates tenant, job, connection, Page, encrypted envelope, actor, message hash, and publishing permission before recording `publishing` and its audit event. A used key never produces another provider request.

Status is loaded for the current job and returns only the latest safe publication summary for that job. A reloaded `publishing` state blocks another attempt. A reloaded `delivery_unknown` state requires the user to confirm that they checked the Facebook Page before the normal review and final approval flow can create a new idempotency key. Failed and published history remains visible without exposing job, connection, Page, or provider identifiers. Switching company or job clears every local approval, idempotency, submission, result, error, and status value before loading the new job-scoped status.

The provider adapter makes exactly one request and has no automatic retry. A definite HTTP rejection becomes `failed`. A timeout, network failure, or persistence uncertainty after the request becomes `delivery_unknown`; the UI tells the user to inspect the Page before attempting any new publication.

All four publication lifecycle audits use the same verified authentication user ID and bounded session-derived actor name and role. No terminal transition substitutes a generic actor identity. If persisting an unknown-delivery transition fails, the browser still receives the safe unknown-delivery response while the durable row remains `publishing`; the same idempotency key and a remounted job-scoped status both prevent another provider request.

The Page token is decrypted from the existing AES-GCM connection envelope with its exact AAD and exists only in Edge memory. Publication history, provider post identifiers, diagnostics, and lifecycle audits are server-only. Browser status responses contain only capability and normalized publication state.

## Production ACL corrective

The foundation rollout detected that Supabase default table grants gave `service_role` broader direct privileges than the migration intended. The rollout stopped before the publishing Edge Function was deployed. A separate corrective migration revokes all direct privileges on `company_social_publications`, restores only `SELECT`, `INSERT`, and `UPDATE` for `service_role`, and repeats the browser-role revocation fail-closed.

The corrective changes no rows, connection state, OAuth state, audit events, RLS, policies, table structure, constraints, indexes, or RPC definitions. It performs no OAuth, Graph, provider, or live publication operation.

## Deferred gates

Remote migration application, Edge deployment, Meta permission changes, OAuth reconnect, App Review, live Graph calls, and live publishing are separate rollout gates. Media upload, Instagram publishing, scheduling, editing, deletion, comments, insights, retries, workers, cron, and webhooks are outside Phase 5C1.
