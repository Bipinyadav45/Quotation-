# syntax=docker/dockerfile:1

# ---------- stage 1: build the frontend ----------
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

# Strip devDependencies in place. node_modules is now linux-native and
# production-only, so the runtime stage needs no compiler at all.
RUN npm prune --omit=dev

# ---------- stage 2: runtime ----------
FROM node:22-bookworm-slim AS runtime
WORKDIR /app

# libreoffice-writer is the only viable PDF backend on Linux.
# --no-install-recommends avoids dragging in the JRE and dictionary packs.
# fonts-liberation gives metric-compatible Times New Roman substitution.
# tzdata so TZ=Asia/Kolkata resolves (financial-year + document dates).
RUN apt-get update && apt-get install -y --no-install-recommends \
      libreoffice-writer \
      fonts-liberation \
      fonts-dejavu-core \
      tzdata \
 && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    PORT=4000 \
    HOME=/home/node

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/web/dist ./web/dist

# ROOT resolves to /app (two levels up from server/src/config.ts), so these
# paths line up with the defaults in config.ts with no env overrides needed.
COPY package.json tsconfig.json ./
COPY shared ./shared
COPY server ./server

# .tmp/pdf is wiped and recreated at boot; data/ holds the SQLite file.
RUN mkdir -p /app/.tmp /app/data && chown -R node:node /app/.tmp /app/data

USER node
EXPOSE 4000

# `degraded` is a 200, so this stays green if LibreOffice is ever absent —
# it is checking that the process answers and the database opened.
HEALTHCHECK --interval=30s --timeout=5s --start-period=45s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["./node_modules/.bin/tsx", "server/src/index.ts"]
