FROM node:22-alpine AS builder
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app

# Install only the workspace metadata needed by the panel so dependency layers
# stay cacheable when application source changes.
COPY package.json ./
COPY apps/panel/package.json ./apps/panel/package.json
RUN npm install --no-audit --no-fund

COPY apps/panel ./apps/panel
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=4310 \
    HOSTNAME=0.0.0.0

RUN addgroup -S -g 1001 nodejs && adduser -S -u 1001 -G nodejs nextjs

# Next.js standalone output contains only the traced production runtime instead
# of source files, TypeScript tooling and the full development dependency tree.
COPY --from=builder --chown=nextjs:nodejs /app/apps/panel/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/panel/.next/static ./apps/panel/.next/static

USER nextjs
EXPOSE 4310
CMD ["node","apps/panel/server.js"]
