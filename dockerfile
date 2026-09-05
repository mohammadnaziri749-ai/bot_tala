# --- Stage 1: Builder ---
FROM node:22-bullseye-slim AS builder

RUN sed -i 's|http://deb.debian.org/debian|https://linux-mirror.liara.ir/debian|g' /etc/apt/sources.list && \
    sed -i 's|http://security.debian.org/debian-security|https://linux-mirror.liara.ir/debian-security|g' /etc/apt/sources.list

WORKDIR /app

COPY package*.json ./

RUN apt-get update && apt-get install -y python3 make g++ && \
    npm install

COPY . .

RUN npm run build

# --- Stage 2: Final ---
FROM python:3.11-slim-bullseye

RUN sed -i 's|http://deb.debian.org/debian|http://linux-mirror.liara.ir/debian|g' /etc/apt/sources.list && \
    sed -i 's|http://security.debian.org/debian-security|http://linux-mirror.liara.ir/debian-security|g' /etc/apt/sources.list

WORKDIR /app

RUN apt-get update && apt-get install -y \
    nodejs \
    libcairo2 \
    libpango-1.0-0 \
    libjpeg62-turbo \
    libgif7 \
    librsvg2-2 \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package*.json ./
COPY . .

RUN pip install --no-cache-dir -r requirements.txt

EXPOSE 3000

CMD ["node", "dist/main"]
