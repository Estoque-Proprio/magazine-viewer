# Build estático (Vite) servido por um servidor Node mínimo (server/), que
# também põe as meta tags de prévia do catálogo no HTML. No Coolify: Build
# Pack "Dockerfile" (não Nixpacks), porta 80 e NPM_TOKEN como variável de
# build (a brightmoon é privada).

FROM node:22-alpine AS build
WORKDIR /app

# Token do GitHub com read:packages, lido pelo .npmrc. Fica só nesta etapa;
# a imagem final não tem .npmrc nem node_modules.
ARG NPM_TOKEN
# Opcional: outra API (ex.: homologação). Padrão: produção.
ARG VITE_API_URL

COPY package.json package-lock.json .npmrc ./
RUN npm ci --no-audit --no-fund

COPY . .
RUN npm run build && npm test

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
# O servidor não tem dependências: só o código dele e o build.
COPY --from=build /app/server ./server
COPY --from=build /app/dist ./dist
# Sem root. A porta 80 funciona assim porque o Docker (20.10+) libera portas
# baixas dentro do container.
USER node
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget -qO- http://127.0.0.1:80/healthz || exit 1
CMD ["node", "server/index.mjs"]
