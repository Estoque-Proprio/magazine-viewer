# Build estático (Vite) servido por nginx. No Coolify: Build Pack "Dockerfile",
# porta 80 e NPM_TOKEN como variável de build (a brightmoon é privada).

FROM node:22-alpine AS build
WORKDIR /app

# Token do GitHub com read:packages, lido pelo .npmrc. Fica só nesta etapa;
# a imagem final não tem node, .npmrc nem node_modules.
ARG NPM_TOKEN
# Opcional: outra API (ex.: homologação). Padrão: produção.
ARG VITE_API_URL

COPY package.json package-lock.json .npmrc ./
RUN npm ci --no-audit --no-fund

COPY . .
RUN npm run build

FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
