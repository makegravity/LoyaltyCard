FROM node:22-alpine
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY server.js ./
COPY lib ./lib
COPY public ./public

# Members, selfies, the admin login and the signing key live in /app/data (a volume).
RUN mkdir -p /app/data && chown node:node /app/data
USER node

ENV NODE_ENV=production PORT=4090 HOST=0.0.0.0 DATA_DIR=/app/data
EXPOSE 4090
CMD ["node", "server.js"]
