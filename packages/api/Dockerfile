FROM node:lts-slim AS builder

# Install pnpm
RUN npm install -g pnpm

WORKDIR /app/

# Copy package files for installation
COPY pnpm-*.yaml ./
COPY package.json ./
COPY packages/api/package.json packages/api/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source files
COPY packages/api/ packages/api

# Build if needed (uncomment if you have a build step)
WORKDIR /app/packages/api
RUN pnpm run build

# Production image
FROM node:lts-slim

# Add curl to be able to do health checks
RUN apt-get -y update && apt-get -y install curl && apt-get clean

RUN npm install -g pnpm

WORKDIR /app

# Copy only the necessary files from builder
COPY --from=builder /app/pnpm-*.yaml ./
COPY --from=builder /app/package.json ./
COPY --from=builder /app/packages/api ./packages/api

# Install only production dependencies
RUN pnpm install --prod --frozen-lockfile

WORKDIR /app/packages/api

# Run the API
ENTRYPOINT ["pnpm", "run", "start"]
