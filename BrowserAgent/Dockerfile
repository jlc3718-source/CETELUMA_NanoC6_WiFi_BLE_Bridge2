FROM node:22-bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium xvfb openbox x11vnc novnc websockify ca-certificates curl tini fonts-liberation \
    && rm -rf /var/lib/apt/lists/*

ARG TARGETARCH
RUN set -eux; \
    case "$TARGETARCH" in amd64|arm64) CFARCH="$TARGETARCH" ;; *) echo "Unsupported arch: $TARGETARCH"; exit 1 ;; esac; \
    curl -fsSL "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${CFARCH}" -o /usr/local/bin/cloudflared; \
    chmod +x /usr/local/bin/cloudflared

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY src ./src
COPY start.sh /start.sh
RUN chmod +x /start.sh

ENV PORT=8932
ENV DATA_DIR=/data
ENV DISPLAY=:99

EXPOSE 8932 6080 6081
ENTRYPOINT ["/usr/bin/tini","--"]
CMD ["/start.sh"]
