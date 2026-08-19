# syntax=docker/dockerfile:1
FROM node:22-slim AS build
WORKDIR /repo

# Install from the workspace root so the agent/web workspace link resolves
# the same way it does locally, then build only the agent package.
COPY package.json package-lock.json ./
COPY agent/package.json agent/package.json
COPY web/package.json web/package.json
RUN npm ci

COPY agent/ agent/
RUN npm run build --workspace agent

FROM node:22-slim AS runtime
WORKDIR /repo
ENV NODE_ENV=production

# npm workspaces hoists agent's dependencies into the root node_modules —
# preserve that same relative layout (agent/ alongside root node_modules)
# rather than collapsing into a flat /app, since Node's resolution walks up
# through node_modules directories to find them.
COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/agent/package.json ./agent/package.json
COPY --from=build /repo/agent/dist ./agent/dist

WORKDIR /repo/agent
EXPOSE 8787
USER node
CMD ["node", "dist/index.js"]
