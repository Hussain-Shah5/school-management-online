# Railway deploy: Node 24 (built-in node:sqlite needs Node >= 22.5)
FROM node:24-alpine
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund
COPY . .
# Railway persistent volume: mount a volume at /data and set
# DATABASE_PATH=/data/school.db so the SQLite file survives redeploys.
ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "server.js"]
