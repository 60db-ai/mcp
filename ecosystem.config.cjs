// PM2 process manifest for the hosted 60db MCP server (https://mcp.60db.ai/mcp).
//
// Usage on the server (Node 20 via nvm):
//   npm ci && npm run build
//   pm2 start ecosystem.config.cjs --env production
//   pm2 save
//   pm2 reload 60db-mcp     # zero-downtime reload after a deploy
//   pm2 logs 60db-mcp
//
// nginx (sites-available/mcp.60db.ai) proxies https://mcp.60db.ai -> 127.0.0.1:8787.

module.exports = {
  apps: [
    {
      name: "60db-mcp",
      script: "./dist/http-server.js",
      exec_mode: "cluster", // stateless server; cluster mode keeps pm2 reload zero-downtime
      instances: 1,
      max_memory_restart: "512M",
      kill_timeout: 10000,
      autorestart: true,
      max_restarts: 10,
      min_uptime: "30s",
      merge_logs: true,
      time: true,
      env: {
        NODE_ENV: "development",
        HOST: "127.0.0.1",
        PORT: 8787,
        SIXTYDB_API_BASE_URL: "http://localhost:4000",
        PUBLIC_MCP_URL: "http://localhost:8787/mcp",
      },
      env_production: {
        NODE_ENV: "production",
        HOST: "127.0.0.1",
        PORT: 8787,
        // Same box as api.60db.ai: call the API on loopback, skip TLS + nginx hop.
        SIXTYDB_API_BASE_URL: "http://127.0.0.1:4000",
        PUBLIC_MCP_URL: "https://mcp.60db.ai/mcp",
        // OAuth secrets are NOT set here: put MCP_OAUTH_SECRET (>= 32 random chars) and
        // optionally GOOGLE_CLIENT_ID in ~/60db-mcp/.env (gitignored), loaded at startup.
      },
    },
  ],
};
