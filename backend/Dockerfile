# Imagem de producao do backend HVAC (publicada no GHCR pelo workflow de deploy).
FROM node:22-slim

WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY . .

# Banco persistente em volume; processo roda sem root.
RUN mkdir -p /data && chown node:node /data
USER node

ENV HOST=0.0.0.0 \
    PORT=3001 \
    DB_PATH=/data/hvac.db
VOLUME ["/data"]
EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:3001/api/health',{headers:{'User-Agent':'healthcheck'}}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Segredos (JWT_SECRET, ADMIN_SENHA, MQTT...) entram por variavel de ambiente no
# provedor de hospedagem - nunca dentro da imagem.
CMD ["node", "server.js"]
