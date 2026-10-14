ARG NODE_IMAGE=node:24-alpine
FROM ${NODE_IMAGE}
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3210 USE_MOCK=true
COPY --chown=node:node package.json server.mjs ./
COPY --chown=node:node src ./src
COPY --chown=node:node dist ./dist
USER node
EXPOSE 3210
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD node -e "fetch('http://127.0.0.1:3210/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "server.mjs"]
