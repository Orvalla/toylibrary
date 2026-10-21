# Toy Library — static SPA served by nginx on Fly.io.
# All data and auth live in Supabase; this image is just the front end,
# so it scales to zero and has no server-side secrets.

# ---- build ----
FROM node:20-alpine AS build
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install

COPY . .

# Vite inlines these at build time. They are the *public* Supabase values:
# safe to ship in the browser bundle because Row Level Security and the
# get_shared_list() RPC do the actual access control in the database.
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL \
    VITE_SUPABASE_ANON_KEY=$VITE_SUPABASE_ANON_KEY

RUN npm run build

# ---- serve ----
FROM nginx:alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
