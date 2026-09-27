# syntax=docker/dockerfile:1

# ---- Stage 1: Build ----
FROM node:22-slim AS builder

WORKDIR /app

# Install OpenSSL & libc (dibutuhkan Prisma engine di beberapa base image slim)
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

# Copy manifest dulu biar layer cache npm install efisien
COPY package.json package-lock.json* ./

# Install semua dependency (termasuk devDependencies, dibutuhkan buat build)
RUN npm ci

# Copy seluruh source code
COPY . .

# Generate Prisma contract artifacts (contract.json, contract.d.ts)
RUN npx prisma contract emit

# Build TypeScript -> dist/ (pakai esbuild sesuai script "build" di package.json)
RUN npm run build

# ---- Stage 2: Production runtime ----
FROM node:22-slim AS runner

WORKDIR /app

RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production

# Copy manifest & install HANYA production dependencies
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

# Copy hasil build dari stage builder
COPY --from=builder /app/dist ./dist

# Copy folder prisma (contract.prisma, contract.json, contract.d.ts, migrations)
# dibutuhkan runtime buat verifikasi contract & migrasi
COPY --from=builder /app/src/prisma ./src/prisma
COPY --from=builder /app/prisma.config.ts ./prisma.config.ts

EXPOSE 3000

CMD ["node", "dist/index.js"]