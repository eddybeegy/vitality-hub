# Deployment

The app runs as a single Node process and is normally deployed with Docker.

## Docker
`docker compose up --build` uses the multi-stage `Dockerfile`:

1. **go-builder** compiles `go-wrapper/main.go` to `gocronometer-wrapper`.
2. **node-builder** runs `npm install` and `npm run build`.
3. **runtime** (`node:20-slim`) installs production dependencies, copies `dist/` and the
   Go binary, and runs `node dist/server.cjs` on port 3000.

`./data` and `./logs` are bind-mounted into `/app/data` and `/app/logs`. With SQLite,
set `SQLITE_PATH=/app/data/health.db` (the compose default) so the database survives a
rebuild.

## Without Docker
```bash
npm ci
npm run build
(cd go-wrapper && go build -o gocronometer-wrapper main.go)
NODE_ENV=production node dist/server.cjs
```

## Environment
See `.env.example`. `JWT_SECRET` has no default anywhere: `docker compose up` fails
with "required variable JWT_SECRET is missing a value" until `.env` sets it
(`openssl rand -base64 32`), and rotating it invalidates every existing session.
At minimum set `JWT_SECRET`, `APP_URL` (used for OAuth redirects),
and `DATABASE_TYPE` with its connection URL. Set `TRUST_PROXY` to a hop count or an
address list when running behind a reverse proxy or tunnel; `true` is refused.
