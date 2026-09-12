FROM node:24-bookworm-slim@sha256:2fe369e969550cde8e867afc3fe370b260140cab4a23d467074295b42163d553 AS build
WORKDIR /app
RUN npm install --global pnpm@11.19.0
COPY . .
RUN pnpm install --frozen-lockfile && pnpm build
FROM node:24-bookworm-slim@sha256:2fe369e969550cde8e867afc3fe370b260140cab4a23d467074295b42163d553
WORKDIR /app
COPY --from=build /app/apps/web/dist apps/web/dist
COPY apps/web/server.mjs apps/web/server.mjs
COPY apps/api/src apps/api/src
COPY packages/domain packages/domain
COPY release.json ./release.json
ENV NODE_ENV=production
ENV PORT=8080
USER node
EXPOSE 8080
CMD ["node", "apps/web/server.mjs"]
