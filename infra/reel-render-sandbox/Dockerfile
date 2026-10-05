FROM node:22-bookworm-slim@sha256:d649c27dae7ba0137b3cef5dd75baa422c08dc3d9e3fc0c23dfb172dc3cc6436

ARG REEL_SOURCE_SHA
ARG REEL_RUNNER_CONTRACT_VERSION
ARG REEL_CANDIDATE_MANIFEST_SHA
LABEL org.opencontainers.image.revision="${REEL_SOURCE_SHA}" \
  io.servicescope.reel.runner-contract="${REEL_RUNNER_CONTRACT_VERSION}" \
  io.servicescope.reel.candidate-manifest="${REEL_CANDIDATE_MANIFEST_SHA}"

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ffmpeg \
    fonts-dejavu-core \
    fonts-liberation2 \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY infra/reel-render-sandbox/Dockerfile ./infra/reel-render-sandbox/Dockerfile
COPY .dockerignore ./.dockerignore
COPY infra/reel-render-sandbox/candidate-manifest.json ./candidate-manifest.json

COPY server/reel-sandbox-runner/package.json server/reel-sandbox-runner/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts=false \
  && npm cache clean --force

COPY server/reel-renderer ./server/reel-renderer
COPY server/reel-editor ./server/reel-editor
COPY src/features/reel-editor/presentation.js ./src/features/reel-editor/presentation.js
COPY public/reel-editor/fonts ./public/reel-editor/fonts
COPY supabase/functions/_shared/content-engine/privacy.js ./supabase/functions/_shared/content-engine/privacy.js
COPY supabase/functions/_shared/privacy/privateValues.js ./supabase/functions/_shared/privacy/privateValues.js
COPY server/reel-render-jobs/contracts.js ./server/reel-render-jobs/contracts.js
COPY server/reel-sandbox-runtime/contracts.js ./server/reel-sandbox-runtime/contracts.js
COPY server/reel-sandbox-runner/runner.js server/reel-sandbox-runner/run.mjs ./server/reel-sandbox-runner/
COPY src/features/reel-director/presentationSpec.js ./src/features/reel-director/presentationSpec.js
COPY supabase/functions/_shared/reel-engine/contracts.js ./supabase/functions/_shared/reel-engine/contracts.js
COPY supabase/functions/_shared/reel-engine/evidenceCapabilities.js ./supabase/functions/_shared/reel-engine/evidenceCapabilities.js
COPY supabase/functions/_shared/reel-engine/manualPlanContract.js ./supabase/functions/_shared/reel-engine/manualPlanContract.js
COPY supabase/functions/_shared/reel-engine/schemas.js ./supabase/functions/_shared/reel-engine/schemas.js
COPY supabase/functions/_shared/content-engine/contracts.js ./supabase/functions/_shared/content-engine/contracts.js
COPY supabase/functions/_shared/content-engine/errors.js ./supabase/functions/_shared/content-engine/errors.js
COPY supabase/functions/_shared/content-engine/schemas.js ./supabase/functions/_shared/content-engine/schemas.js

RUN mkdir -p /vercel/sandbox/reel/input /vercel/sandbox/reel/output \
  && chown -R node:node /vercel/sandbox

USER node

CMD ["node", "/app/server/reel-sandbox-runner/run.mjs"]
