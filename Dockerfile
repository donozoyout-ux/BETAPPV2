FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY scripts ./scripts
COPY src ./src
RUN npm run build

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN addgroup -S betapp && adduser -S betapp -G betapp
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=builder --chown=betapp:betapp /app/dist ./dist
USER betapp
EXPOSE 3000
CMD ["sh", "-c", "node dist/db/migrate.js && exec node dist/runtime.js"]
