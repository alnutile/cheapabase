# One image: Bun gateway + PostgREST and Supabase Auth binaries.
FROM postgrest/postgrest:v12.2.12 AS postgrest
FROM supabase/auth:v2.177.0 AS auth

FROM oven/bun:1.3.0-debian
WORKDIR /app

# PostgREST's ARM64 build needs glibc, libpq and GMP. Use Debian on both
# architectures so Docker Desktop and Linux hosts use the same runtime.
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates libpq5 libgmp10 wget \
    && rm -rf /var/lib/apt/lists/*

COPY --from=postgrest /bin/postgrest /usr/local/bin/postgrest
COPY --from=auth /usr/local/bin/auth /usr/local/bin/auth
COPY --from=auth /usr/local/etc/auth/migrations /usr/local/etc/auth/migrations

# Fail the build immediately if either upstream binary cannot run.
RUN postgrest --version && auth version

COPY package.json bun.lock ./
RUN bun install --production --frozen-lockfile

COPY server ./server
COPY db ./db
COPY functions ./functions
COPY client ./client
COPY examples/vanilla ./examples/vanilla

ENV PORT=8000
EXPOSE 8000
USER bun
CMD ["bun", "run", "server/index.ts"]
