FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./tsconfig.json
COPY database.types.ts gltf-validator.d.ts ./
COPY app ./app
COPY collaboration ./collaboration
RUN npm run build:collaboration

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production PORT=1234
WORKDIR /app/collaboration
COPY collaboration/package.json collaboration/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY --from=build /app/collaboration/dist ./dist
USER node
EXPOSE 1234
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/healthz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "dist/collaboration/src/server.js"]
