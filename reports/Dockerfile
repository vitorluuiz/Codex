# syntax=docker/dockerfile:1

FROM node:20-alpine AS base
WORKDIR /app

FROM base AS deps
COPY package.json ./
RUN npm install

FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM base AS runner
ENV NODE_ENV=production
RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 reports

COPY package.json ./
RUN npm install --omit=dev && npm cache clean --force
COPY --from=builder --chown=reports:nodejs /app/dist ./dist

USER reports
EXPOSE 4002

CMD ["node", "dist/index.js"]
