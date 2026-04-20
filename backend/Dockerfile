FROM node:20-alpine

WORKDIR /app

# Install deps first for better caching
COPY package.json package-lock.json* ./
RUN npm install --omit=dev

# Copy source
COPY src ./src
COPY migrations ./migrations

# Uploads directory
RUN mkdir -p /app/uploads && chown -R node:node /app

USER node

EXPOSE 3000

# default to running the combined server (HTTP + bot + jobs)
CMD ["node", "src/index.js"]
