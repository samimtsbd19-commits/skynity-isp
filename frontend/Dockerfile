# ---- build stage ----
FROM node:20-alpine AS build
WORKDIR /app
# Force devDependencies install even if NODE_ENV=production is injected
# by the deploy platform (Coolify, Docker Manager, etc.). Vite & friends
# live in devDependencies and are required to produce /app/dist.
ENV NODE_ENV=development
COPY package.json package-lock.json* ./
RUN npm install --include=dev
COPY . .
RUN npm run build

# ---- serve stage ----
FROM nginx:1.27-alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
