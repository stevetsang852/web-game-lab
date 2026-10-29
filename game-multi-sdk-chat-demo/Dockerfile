FROM node:22-alpine AS build

WORKDIR /workspace

COPY game-multi-sdk/package.json ./game-multi-sdk/package.json
COPY game-multi-sdk/packages/core/package.json ./game-multi-sdk/packages/core/package.json
COPY game-multi-sdk/packages/react/package.json ./game-multi-sdk/packages/react/package.json
COPY game-multi-sdk/packages/transport-rtc-host/package.json ./game-multi-sdk/packages/transport-rtc-host/package.json
COPY game-multi-sdk/packages/transport-server/package.json ./game-multi-sdk/packages/transport-server/package.json

WORKDIR /workspace/game-multi-sdk
RUN npm install

COPY game-multi-sdk/ ./
RUN npm run build --workspace=@game-multi-sdk/core \
    && npm run build --workspace=@game-multi-sdk/transport-rtc-host

WORKDIR /workspace/game-multi-sdk-chat-demo
COPY game-multi-sdk-chat-demo/package.json ./
RUN npm install
COPY game-multi-sdk-chat-demo/ ./
RUN npm run build

FROM nginx:alpine
COPY --from=build /workspace/game-multi-sdk-chat-demo/dist/ /usr/share/nginx/html/
EXPOSE 80
