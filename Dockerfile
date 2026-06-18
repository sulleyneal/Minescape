# Container image for hosting Minescape anywhere that runs Docker
# (Fly.io, Railway, a VPS, etc). Builds the client, then serves client + game
# WebSocket from one port.
FROM node:20-slim

WORKDIR /app

# Install all deps (incl. dev) so Vite can build the client.
COPY package.json package-lock.json ./
RUN npm install --include=dev

# Build the client bundle into dist/.
COPY . .
RUN npm run build

ENV NODE_ENV=production
# Hosts inject PORT; default to 8080 locally.
ENV PORT=8080
EXPOSE 8080

CMD ["npm", "start"]
