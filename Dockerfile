# syntax=docker/dockerfile:1

# ---------- stage 1: build ----------
# NODE_ENV must NOT be "production" here — `npm ci` would omit vite/tailwind
# and the build would fail. It is set in the runtime stage only.
FROM node:22-bookworm-slim AS build
WORKDIR /app

# better-sqlite3 is a native addon. A linux-x64 prebuild normally exists, but
# these make the node-gyp fallback work instead of failing the build.
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 make g++ \
 && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# ---------- stage 2: test ----------
# Inherits the build stage, so devDependencies (vitest) and web/dist are both
# present. CI runs this rather than testing on the host, for two reasons:
#
#   pdf.test.ts uses `it.runIf(config.pdfBackend)` — with no converter
#   installed those assertions VANISH and the job still passes green. Installing
#   LibreOffice here is what makes the PDF tests actually execute, against the
#   same backend production uses.
#
#   bundle-safety.test.ts only runs `if (built)` — it greps web/dist for the
#   literal API key. It needs the build to have happened first, which it has.
FROM build AS test
RUN apt-get update && apt-get install -y --no-install-recommends \
      libreoffice-writer \
      fonts-liberation \
      fonts-dejavu-core \
      tzdata \
 && rm -rf /var/lib/apt/lists/*
ENV TZ=Asia/Kolkata \
    PDF_BACKEND=libreoffice
CMD ["npm", "test"]

# ---------- stage 3: production dependencies ----------
# Split from `build` so the test stage above keeps its devDependencies.
# node_modules is linux-native and production-only after this, so the runtime
# stage needs no compiler at all.
FROM build AS prod-deps
RUN npm prune --omit=dev

# ---------- stage 4: runtime ----------
FROM node:22-bookworm-slim AS runtime
WORKDIR /app

# libreoffice-writer is the only viable PDF backend on Linux — the Word/COM
# path in pdf.ts is Windows-only and Microsoft advise against Office automation
# on a server. --no-install-recommends avoids dragging in the JRE and
# dictionary packs. fonts-liberation gives metric-compatible Times New Roman
# substitution. tzdata so TZ below resolves.
RUN apt-get update && apt-get install -y --no-install-recommends \
      libreoffice-writer \
      fonts-liberation \
      fonts-dejavu-core \
      tzdata \
 && rm -rf /var/lib/apt/lists/*

# TZ is set, not merely available: shared/ derives the Indian financial year and
# every document date from the local clock, so a container running UTC would
# label an early-April quotation with the previous financial year.
#
# PDF_BACKEND is pinned rather than auto-detected. Detection would also succeed
# here, but pinning means a missing LibreOffice fails loudly instead of quietly
# downgrading /api/health to "degraded" and disabling the PDF button.
ENV NODE_ENV=production \
    PORT=4000 \
    TZ=Asia/Kolkata \
    PDF_BACKEND=libreoffice \
    HOME=/home/node

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/web/dist ./web/dist

# ROOT resolves to /app (two levels up from server/src/config.ts), so these
# paths line up with the defaults in config.ts with no env overrides needed.
COPY package.json tsconfig.json ./
COPY shared ./shared
COPY server ./server

# .tmp/pdf is wiped and recreated at boot; data/ holds the SQLite file.
# /home/node is chowned because LibreOffice writes into HOME on first run.
RUN mkdir -p /app/.tmp /app/data /home/node \
 && chown -R node:node /app/.tmp /app/data /home/node

# Declared so a deploy that forgets `-v` gets an anonymous volume rather than
# writing the database to the container layer, where the next redeploy would
# silently destroy it. Deploys should still mount a named volume explicitly.
VOLUME ["/app/data"]

USER node
EXPOSE 4000

# `degraded` is a 200, so this stays green if LibreOffice is ever absent —
# it is checking that the process answers and the database opened.
HEALTHCHECK --interval=30s --timeout=5s --start-period=45s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["./node_modules/.bin/tsx", "server/src/index.ts"]
