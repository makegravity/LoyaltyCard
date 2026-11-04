FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY server.js ./
COPY lib ./lib
COPY scripts ./scripts
COPY public ./public

# Everything lives in MySQL, so the app writes nothing to disk and can run read-only.
USER node
ENV PORT=4090 HOST=0.0.0.0
EXPOSE 4090
CMD ["node", "server.js"]
