FROM node:22-bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium xvfb openbox ca-certificates curl tini fonts-liberation \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY src ./src
COPY start.sh /start.sh
RUN chmod +x /start.sh

ENV PORT=8932
ENV DATA_DIR=/data
ENV DISPLAY=:99

EXPOSE 8932
ENTRYPOINT ["/usr/bin/tini","--"]
CMD ["/start.sh"]
