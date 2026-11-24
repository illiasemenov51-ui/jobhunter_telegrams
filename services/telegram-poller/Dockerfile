FROM node:22-alpine

WORKDIR /app
COPY index.js index.test.cjs ./
RUN mkdir -p /state && chown node:node /state
VOLUME ["/state"]
USER node

CMD ["node", "index.js"]
