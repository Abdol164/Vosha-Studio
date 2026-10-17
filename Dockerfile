FROM node:22-bookworm-slim

# Chrome Headless Shell runtime libs (Remotion's documented Debian list) + CA certs for
# the photo fetch, facilitator and Anthropic calls. fonts-noto-color-emoji so captions/
# copy with emoji don't render as boxes.
RUN apt-get update && apt-get install -y --no-install-recommends \
		ca-certificates \
		libnss3 libdbus-1-3 libatk1.0-0 libatk-bridge2.0-0 libgbm1 libasound2 \
		libxrandr2 libxkbcommon0 libxfixes3 libxcomposite1 libxdamage1 \
		libpango-1.0-0 libcairo2 libcups2 \
		fonts-noto-color-emoji \
	&& rm -rf /var/lib/apt/lists/*

# Same bun that wrote bun.lock (lockfile v2), so --frozen-lockfile accepts it.
COPY --from=oven/bun:1.4.3-debian /usr/local/bin/bun /usr/local/bin/bun

WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# Download Chrome at build time: a runtime download on first render can fail and used to
# take the process down (see NOTES.md, MON-36).
RUN node_modules/.bin/remotion browser ensure

COPY tsconfig.json ./
COPY src ./src
COPY remotion ./remotion
COPY public ./public

# Prebuild the Remotion bundle here: webpack peaks ~650 MB, too much to do at boot on a
# small instance. render.ts uses it when REMOTION_BUNDLE_DIR points at it.
RUN node_modules/.bin/remotion bundle remotion/index.ts --out-dir=/app/build

ENV NODE_ENV=production \
	PORT=3000 \
	DATA_DIR=/app/data \
	REMOTION_BUNDLE_DIR=/app/build
RUN mkdir -p /app/data && chown -R node:node /app
USER node
VOLUME /app/data
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=120s --retries=3 \
	CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"

CMD ["node", "--import", "tsx", "src/server.ts"]
