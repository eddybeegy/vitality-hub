# Stage 1: Build the Go wrapper for Cronometer sync
FROM golang:1.26 AS go-builder
WORKDIR /app
COPY go-wrapper/ ./go-wrapper/
RUN cd go-wrapper && go mod tidy && go build -o gocronometer-wrapper main.go

# Stage 2: Build the Node.js application
FROM node:20-slim AS node-builder
WORKDIR /app
COPY package*.json ./
RUN apt-get update && apt-get install -y python3 make g++ tzdata && rm -rf /var/lib/apt/lists/*
RUN npm install
COPY . .
# Copy the built binary from stage 1 for the build script to run correctly if it expects it
COPY --from=go-builder /app/go-wrapper/gocronometer-wrapper ./go-wrapper/
RUN npm run build

# Stage 3: Final production image
FROM node:20-slim
WORKDIR /app

# Install runtime dependencies for better-sqlite3 and other native modules
RUN apt-get update && apt-get install -y python3 make g++ tzdata && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm install --omit=dev

# Copy build artifacts
COPY --from=node-builder /app/dist ./dist
COPY --from=node-builder /app/dist/server.cjs ./dist/server.cjs
COPY --from=go-builder /app/go-wrapper/gocronometer-wrapper ./go-wrapper/gocronometer-wrapper
RUN chmod +x ./go-wrapper/gocronometer-wrapper || true

# Create necessary directories
RUN mkdir -p logs data

# Expose the application port
EXPOSE 3000

# Set environment variables
ENV NODE_ENV=production
ENV PORT=3000
ENV PATH="/usr/local/bin:$PATH"

# Start the application
ENTRYPOINT ["/usr/local/bin/node"]
CMD ["dist/server.cjs"]
