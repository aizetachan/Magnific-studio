# Magnific Studio — single container: Director backend + built SPA + ffmpeg.
# The server is stateless for CONTENT (assets live on each user's machine);
# only encrypted Magnific OAuth sessions touch STORAGE_DIR. Works on Cloud Run
# (no volume needed — a restart just asks users to reconnect Magnific, 1 click).

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine
RUN apk add --no-cache ffmpeg
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY server ./server
COPY --from=build /app/dist ./dist
ENV NODE_ENV=production \
    PORT=8080 \
    STORAGE_DIR=/tmp/ms-storage \
    DIST_DIR=/app/dist
EXPOSE 8080
CMD ["node", "server/index.mjs"]
