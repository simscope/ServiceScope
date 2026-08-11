FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ffmpeg \
    fonts-dejavu-core \
    fonts-liberation2 \
    time

WORKDIR /workspace

COPY package.json package-lock.json ./
RUN npm ci

COPY server/reel-renderer ./server/reel-renderer
COPY src/features/reel-director/presentationSpec.js ./src/features/reel-director/presentationSpec.js
COPY supabase/functions/_shared ./supabase/functions/_shared
COPY qualification/reel-runtime/benchmark.mjs ./qualification/reel-runtime/benchmark.mjs
COPY qualification/reel-runtime/ffmpeg-measured.sh ./qualification/reel-runtime/ffmpeg-measured.sh
RUN chmod 0755 ./qualification/reel-runtime/ffmpeg-measured.sh

CMD ["node", "qualification/reel-runtime/benchmark.mjs"]
