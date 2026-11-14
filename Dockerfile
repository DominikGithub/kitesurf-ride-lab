FROM node:22-alpine

WORKDIR /app

COPY package.json server.mjs ./
COPY public ./public

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8082

EXPOSE 8082

USER node

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s \
  CMD wget -q -O /dev/null http://127.0.0.1:8082/ || exit 1

CMD ["node", "server.mjs"]
