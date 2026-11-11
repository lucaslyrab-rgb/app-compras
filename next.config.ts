import type { NextConfig } from "next";

// Ambiente local: libera o acesso pelo celular na rede de casa (DEV_LAN_HOSTS no .env).
const devLanHosts = (process.env.DEV_LAN_HOSTS ?? "")
  .split(",")
  .map((host) => host.trim())
  .filter(Boolean);

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  allowedDevOrigins: ["127.0.0.1", ...devLanHosts],
  serverExternalPackages: ["sharp"],
  experimental: {
    typedEnv: true,
    serverActions: {
      bodySizeLimit: "12mb",
    },
  },
};

export default nextConfig;
