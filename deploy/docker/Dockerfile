# QuickLoan images (docs/docker-deployment.md). Build from the repo root:
#   docker compose -f deploy/docker/compose.yml --env-file /etc/quickloan/docker.env build
# Targets:
#   api  both APIs (the compose file runs it twice: borrower and admin, one process each)
#   web  nginx with both built frontends, forwarding each site's /api to its own API
# Debian 13 base: the prebuilt SQLite module needs glibc 2.38 or newer (Debian 12 fails at start-up).

FROM node:22-trixie-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY shared/frontend/package.json shared/frontend/
COPY shared/backend/package.json shared/backend/
COPY borrower-app/frontend/package.json borrower-app/frontend/
COPY borrower-app/backend/package.json borrower-app/backend/
COPY admin-app/frontend/package.json admin-app/frontend/
COPY admin-app/backend/package.json admin-app/backend/
RUN npm ci --no-audit --no-fund

FROM deps AS build
COPY . .
# Built into the frontends: each calls its API on its own site (/api); the links between the sites are absolute.
ARG PUBLIC_BORROWER_URL
ARG PUBLIC_ADMIN_URL
RUN test -n "$PUBLIC_BORROWER_URL" && test -n "$PUBLIC_ADMIN_URL" \
 && VITE_API_URL=/api VITE_ADMIN_URL="$PUBLIC_ADMIN_URL" npm run build -w @quickloan/borrower-frontend \
 && VITE_API_URL=/api VITE_BORROWER_URL="$PUBLIC_BORROWER_URL" npm run build -w @quickloan/admin-frontend \
 && npm prune --omit=dev --no-audit --no-fund

FROM node:22-trixie-slim AS api
# sqlite3: online backups (deploy/backup.sh runs inside this container).
RUN apt-get update && apt-get install -y --no-install-recommends sqlite3 \
 && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production \
    DB_PATH=/var/lib/quickloan/database.sqlite \
    UPLOAD_DIR=/var/lib/quickloan/uploads \
    BACKUP_DIR=/var/backups/quickloan
WORKDIR /app
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/shared/backend ./shared/backend
COPY --from=build /app/borrower-app/backend ./borrower-app/backend
COPY --from=build /app/admin-app/backend ./admin-app/backend
COPY --from=build /app/deploy ./deploy
# The data volume is mounted here; a new named volume takes this ownership. Runs as the image's node user.
RUN mkdir -p /var/lib/quickloan/uploads /var/backups/quickloan \
 && chown -R node:node /var/lib/quickloan /var/backups/quickloan
USER node
VOLUME ["/var/lib/quickloan"]
CMD ["node", "borrower-app/backend/server.js"]

# 1.28 or newer: upstream servers with `resolve`, so nginx follows the API containers when they are recreated.
FROM nginx:1.28 AS web
RUN rm -f /etc/nginx/conf.d/default.conf && mkdir -p /etc/nginx/snippets
COPY deploy/nginx/quickloan-locations.conf /etc/nginx/snippets/
# As shipped: open to all. compose.yml mounts the server's own copy over it (office/VPN limit).
COPY deploy/nginx/quickloan-admin-access.conf /etc/nginx/snippets/
# The nginx image fills in ${BORROWER_HOST} / ${ADMIN_HOST} at start-up and writes it to conf.d/.
COPY deploy/docker/nginx.conf.template /etc/nginx/templates/quickloan.conf.template
COPY --from=build /app/borrower-app/frontend/dist /var/www/quickloan/borrower
COPY --from=build /app/admin-app/frontend/dist /var/www/quickloan/admin
