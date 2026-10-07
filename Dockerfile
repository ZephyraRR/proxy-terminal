FROM node:22-alpine
WORKDIR /app
COPY index.html script.js style.css server.js proxies.json ./
ENV HOST=0.0.0.0 PORT=3000
EXPOSE 3000
USER node
CMD ["node", "server.js"]
