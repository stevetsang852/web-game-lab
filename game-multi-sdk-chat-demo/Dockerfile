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
RUN npm run build

FROM nginxinc/nginx-unprivileged:alpine AS runtime
COPY --from=build /workspace/game-multi-sdk-chat-demo/dist/ /usr/share/nginx/html/
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/ || exit 1
