FROM node:24-bookworm-slim@sha256:2fe369e969550cde8e867afc3fe370b260140cab4a23d467074295b42163d553
WORKDIR /app
RUN npm install --global pnpm@11.19.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/domain/package.json packages/domain/package.json
RUN pnpm install --frozen-lockfile --prod --filter @crm/api
COPY apps/api/src apps/api/src
COPY apps/worker/src apps/worker/src
COPY apps/scheduler/src apps/scheduler/src
COPY packages/domain packages/domain
COPY release.json ./release.json
ENV NODE_ENV=production
ENV PORT=8080
USER node
EXPOSE 8080
CMD ["node", "apps/api/src/cloud-entry.mjs", "api"]
