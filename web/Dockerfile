# syntax=docker/dockerfile:1
FROM node:22-slim AS build
WORKDIR /repo

COPY package.json package-lock.json ./
COPY agent/package.json agent/package.json
COPY web/package.json web/package.json
RUN npm ci

# The web build only needs agent's streaming-types source (via the
# workspace "exports" field), not its compiled output or dependencies.
COPY agent/src/streaming-types.ts agent/src/streaming-types.ts
COPY web/ web/
RUN npm run build --workspace web

FROM nginx:1.27-alpine AS runtime
COPY web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/web/dist /usr/share/nginx/html
EXPOSE 80
