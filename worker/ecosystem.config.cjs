module.exports = {
  apps: [
    {
      name: "solshield-cdp",
      script: "npm",
      args: "run cdp:start",
      cwd: __dirname + "/..",
      instances: 1,
      autorestart: true,
      max_memory_restart: "900M",
      env: {
        NODE_ENV: "production",
        CDP_HOST: "127.0.0.1",
        CDP_PORT: "3001",
      },
    },
    {
      name: "solshield-bot",
      script: "npm",
      args: "run bot:start",
      cwd: __dirname + "/..",
      instances: 1,
      autorestart: true,
      max_memory_restart: "750M",
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
