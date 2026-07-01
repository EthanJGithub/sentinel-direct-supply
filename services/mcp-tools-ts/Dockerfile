# NOTE: build context is the REPO ROOT (see docker-compose.yml `context: .` /
# DEPLOY.md) so this Dockerfile can bake the regulation corpus into the image.
# A standalone `docker build` from this directory will NOT find ../../data —
# see DEPLOY.md for the exact build command.

FROM node:20-slim AS build
WORKDIR /app
COPY services/mcp-tools-ts/package.json services/mcp-tools-ts/package-lock.json* ./
RUN npm install --no-audit --no-fund
COPY services/mcp-tools-ts/tsconfig.json ./
COPY services/mcp-tools-ts/src ./src
RUN npm run build

FROM node:20-slim AS runtime
WORKDIR /app
COPY services/mcp-tools-ts/package.json services/mcp-tools-ts/package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund
COPY --from=build /app/dist ./dist
# data baked into the image (repo-root build context); docker-compose's volume
# mount overrides this path for local dev so edits show up without a rebuild.
COPY data /data
ENV DATA_DIR=/data
ENV PORT=7100
EXPOSE 7100
CMD ["node", "dist/httpServer.js"]
