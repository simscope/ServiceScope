# Controlled Reel render pipeline

## Boundary and flow

The render path is separate from every Meta publication path:

`immutable Creative Plan -> durable approval -> render job -> atomic claim -> isolated Sandbox -> FFmpeg -> FFprobe validation -> private render artifact -> completed job`

An authenticated company owner or user with full AI Assistant access first approves the exact persisted plan revision through `approve_company_reel_creative_plan`; read-only access cannot approve or request rendering. `begin_company_reel_render_request` fails closed unless that immutable approval exists. The render fingerprint binds the plan revision and JSON snapshot to the renderer, presentation, and output-contract versions. Render completion never invokes a social provider and does not grant publication approval.

## Runtime controls

- `REEL_RENDER_ENABLED` gates both request dispatch and queue consumption. Production remains disabled until a separate rollout explicitly enables it.
- `REEL_RENDER_RUNTIME` must be `sandbox` and `REEL_RENDER_SANDBOX_IMAGE` must be an immutable VCR SHA-256 digest.
- The Sandbox receives one CPU, a 240-second session limit, a 210-second command limit, no persistence, and `deny-all` networking.
- No environment variables are passed to the Sandbox. The FFmpeg child receives no application secrets.
- The runner uses fixed Node, FFmpeg, and FFprobe executables, a fixed working directory, internally generated paths, and argument arrays with `shell: false`.

## Input and output contracts

The browser may submit only a Creative Plan UUID and expected revision. Company, job, ordered attachments, template, duration, text, and output settings are reconstructed from the immutable server-side plan and current authoritative media evidence. Media is tenant checked, bounded, checksum verified, signature validated, and staged under generated per-job names. URLs, protocols, paths, filters, codecs, and executable names are not accepted from the browser.

The bounded output is MP4/H.264, 1080x1920, 30 fps, `yuv420p`, 12-25 seconds, silent, and fast-start enabled. FFprobe independently verifies the stream count, codec, dimensions, duration, frame rate, pixel format, size, and MP4 fast-start layout. Completion persists the private object keys, byte lengths, video and cover SHA-256 values, plan identity, render fingerprint, and completion time. Signed artifact URLs are short lived and internal filesystem paths are never returned.

## Claims, retry, and cleanup

Claims are atomic and lease based. A concurrent worker receives no claim, completed and failed rows are immutable terminal states, and an expired lease can be reclaimed up to five total attempts. Identical immutable requests resolve to the same render job and deterministic object keys. Transient Sandbox, queue, and storage failures are retried within those bounds; privacy, ownership, stale context, unsupported media, invalid plans, and invalid output are terminal.

Worker staging, downloaded Sandbox output, renderer intermediates, and Sandbox sessions are cleaned in `finally` paths on success and failure. Original attachments and completed private artifacts are outside temporary cleanup.

## Observability

Structured telemetry is restricted to event names, render-job IDs, bounded attempt numbers, safe error codes, and timestamps. Events cover request and feature-flag rejection, privacy rejection, claims, Sandbox/FFmpeg execution, timeout, output validation, completion, and cleanup. Plans, captions, notes, attachment contents, stderr, secrets, tokens, and environment dumps are not recorded.

## Deployment requirements

After review and merge, apply `20260814143000_reel_render_controlled_pipeline.sql` before enabling rendering. Vercel must have the Queue integration, the digest-pinned Sandbox image, and the render runtime variables. No Supabase Edge Function deployment is required by this pipeline change. Activation and any future Meta Reel delivery remain separate approved rollout phases.
