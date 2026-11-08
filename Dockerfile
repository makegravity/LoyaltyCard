FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
# ONNX Runtime Web ships a build for every browser; Node loads only these three files.
RUN npm ci --omit=dev && npm cache clean --force \
  && find node_modules/onnxruntime-web/dist -type f ! -name 'ort.node.min.js' \
    ! -name 'ort-wasm-simd-threaded.mjs' ! -name 'ort-wasm-simd-threaded.wasm' -delete

COPY server.js ./
COPY lib ./lib
COPY models ./models
COPY scripts ./scripts
COPY public ./public

# Everything lives in MySQL, so the app writes nothing to disk and can run read-only.
USER node
ENV PORT=4090 HOST=0.0.0.0
EXPOSE 4090
CMD ["node", "server.js"]
