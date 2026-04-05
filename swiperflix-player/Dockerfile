FROM node:22-alpine AS base
WORKDIR /app
RUN apk add --no-cache libc6-compat \
  && corepack enable \
  && rm -rf /var/cache/apk/*

FROM base AS deps
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm run build

FROM nginx:alpine AS runner
COPY --from=builder /app/dist /usr/share/nginx/html
COPY <<'EOF' /etc/nginx/conf.d/default.conf
server {
    listen 3000;
    root /usr/share/nginx/html;
    index index.html;

    location /api/ {
        proxy_pass http://gateway:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    location / {
        try_files $uri $uri/ /index.html;
    }
}
EOF

EXPOSE 3000
CMD ["nginx", "-g", "daemon off;"]
