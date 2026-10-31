FROM node:22-alpine AS build
WORKDIR /workspace

# Copy package manifests first to keep dependency installation cached.
COPY game-multi-sdk/package.json ./game-multi-sdk/package.json
COPY game-multi-sdk/packages/core/package.json ./game-multi-sdk/packages/core/package.json
COPY game-multi-sdk/packages/react/package.json ./game-multi-sdk/packages/react/package.json
COPY game-multi-sdk/packages/transport-rtc-host/package.json ./game-multi-sdk/packages/transport-rtc-host/package.json
COPY game-multi-sdk/packages/transport-server/package.json ./game-multi-sdk/packages/transport-server/package.json

WORKDIR /workspace/game-multi-sdk
RUN npm install --no-audit --no-fund

COPY game-multi-sdk/ ./
RUN npm run build \
    && npm test --workspace=@game-multi-sdk/core \
    && npm test --workspace=@game-multi-sdk/transport-rtc-host

WORKDIR /workspace/game-multi-sdk-chat-demo
COPY game-multi-sdk-chat-demo/package.json ./
RUN npm install --no-audit --no-fund
COPY game-multi-sdk-chat-demo/ ./
RUN npm test && npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
COPY --from=build --chown=node:node /workspace/game-multi-sdk-chat-demo/dist/ ./dist/
COPY --from=build --chown=node:node /workspace/game-multi-sdk-chat-demo/server/turn-credentials.mjs ./server/turn-credentials.mjs
COPY --from=build --chown=node:node /workspace/game-multi-sdk-chat-demo/server/static-server.mjs ./server/static-server.mjs
ENV NODE_ENV=production
ENV PORT=8080
ENV STATIC_ROOT=/app/dist
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/static-server.mjs"]
