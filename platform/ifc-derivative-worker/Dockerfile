# Repository-root build context is required:
# docker build -f platform/ifc-derivative-worker/Dockerfile .
FROM rust:1.80.1-bookworm AS converter-build
WORKDIR /build/tools/ifc-derivative
COPY tools/ifc-derivative/Cargo.toml tools/ifc-derivative/Cargo.lock ./
COPY tools/ifc-derivative/src ./src
RUN cargo build --locked --release --bin ifc-derivative \
  && strip target/release/ifc-derivative

FROM node:22-bookworm-slim AS node-build
WORKDIR /build/platform/ifc-derivative-worker
COPY platform/ifc-derivative-worker/package.json platform/ifc-derivative-worker/package-lock.json ./
RUN npm ci
COPY platform/ifc-derivative-worker/src ./src
COPY platform/app /build/platform/app
RUN npm run build

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production \
  PORT=8080 \
  IFC_DERIVATIVE_CONVERTER_PATH=/opt/1hk/bin/ifc-derivative
WORKDIR /app
COPY platform/ifc-derivative-worker/package.json platform/ifc-derivative-worker/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts \
  && npm cache clean --force
COPY --chown=node:node --from=node-build /build/platform/ifc-derivative-worker/dist ./dist
COPY --from=converter-build /build/tools/ifc-derivative/target/release/ifc-derivative /opt/1hk/bin/ifc-derivative
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/healthz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "dist/server.mjs"]
