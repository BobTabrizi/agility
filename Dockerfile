# Two stages: the first has every dev tool and runs the build; the final image
# only gets production packages and the built output (.next/, dist/, public/).

FROM node:24-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
# The build cache is only useful to the next build, not at runtime.
RUN npm run build && rm -rf .next/cache


FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000

COPY package.json package-lock.json ./
# npm installs Next's compiler (SWC) and sharp's binaries for both Linux C
# libraries, glibc and Alpine's musl; the glibc ones (~110 MB) can never load here.
# (The musl SWC is still needed: Next uses it to load next.config.ts.)
RUN npm ci --omit=dev && npm cache clean --force \
  && rm -rf node_modules/@next/swc-*-gnu* node_modules/@img/sharp-linux-* node_modules/@img/sharp-libvips-linux-*

COPY --from=build /app/.next ./.next
COPY --from=build /app/dist ./dist
COPY --from=build /app/public ./public
COPY next.config.ts ./
# Creates the tables in DynamoDB Local (docker-compose.yml); unused otherwise.
COPY scripts/create-local-tables.mjs ./scripts/

# The image's unprivileged user, not root. Next writes its runtime cache
# under .next, so that one folder is theirs.
RUN chown -R node:node .next
USER node

EXPOSE 3000

# 127.0.0.1, not localhost: busybox resolves localhost to ::1 first, and the
# server listens on IPv4.
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
  CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1

# node directly (not npm start), so `docker stop`'s SIGTERM reaches the app and
# the graceful shutdown runs.
CMD ["node", "--enable-source-maps", "dist/server.cjs"]
