FROM node:22-bookworm-slim
WORKDIR /app
COPY JasonHome2Server/server.mjs JasonHome2Server/catalog.json ./
COPY JasonHome2Server/web/ ./web/
ENV JH2_PORT=8081 JH2_DATA_DIR=/data
VOLUME /data
EXPOSE 8081
USER node
CMD ["node","--no-warnings=ExperimentalWarning","server.mjs"]
