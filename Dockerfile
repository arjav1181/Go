# syntax=docker/dockerfile:1

###############################################################################
# go. — production image
#
# Multi-stage so the final image carries neither the build toolchain nor the
# full dependency tree. Next.js `output: 'standalone'` means the server bundle
# already contains the minimal node_modules it needs, so the runner stage copies
# that instead of installing anything.
#
# A note on the two classes of variable, because getting this wrong is the
# classic Next-in-Docker bug:
#
#   NEXT_PUBLIC_* values are inlined into the client bundle at BUILD time.
#   Changing one at run time does nothing — they are already compiled in. They
#   must be passed as build args.
#
#   Server-only values (SUPABASE_SERVICE_ROLE_KEY, CRON_SECRET, …) are read at
#   run time and must NOT be baked into an image layer. They are supplied as
#   environment variables instead.
###############################################################################

ARG NODE_VERSION=22

# --- deps --------------------------------------------------------------------
FROM node:${NODE_VERSION}-alpine AS deps
WORKDIR /app

# Copy manifests first so a source-only change reuses the cached install layer.
COPY package.json package-lock.json ./
RUN npm ci

# --- builder -----------------------------------------------------------------
FROM node:${NODE_VERSION}-alpine AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Baked into the client bundle. Safe to pass in: these are the publishable
# values, never the service role key.
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ARG NEXT_PUBLIC_APP_URL=http://localhost:3000
ARG NEXT_PUBLIC_SITE_URL=http://localhost:3000
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL \
    NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY \
    NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL \
    NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL \
    NEXT_TELEMETRY_DISABLED=1

RUN npm run build

# --- runner ------------------------------------------------------------------
FROM node:${NODE_VERSION}-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

# Run unprivileged. The node image already provides a `node` user (uid 1000).
RUN addgroup --system --gid 1001 nodejs \
 && adduser  --system --uid 1001 nextjs

COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
# `standalone` deliberately omits these two; without them the server boots but
# serves no CSS, no fonts and no icons.
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

USER nextjs
EXPOSE 3000

# Uses /api/health, which is a constant response and touches no database, so a
# container that cannot reach Postgres is still reported healthy. Readiness is
# /api/ready and does depend on the database.
HEALTHCHECK --interval=30s --timeout=3s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]