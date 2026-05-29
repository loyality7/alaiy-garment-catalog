import type { NextConfig } from "next";

const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000";
const backendHost = new URL(backendUrl).hostname;
const backendPort = new URL(backendUrl).port || "8000";

const nextConfig: NextConfig = {
  /* Proxy API calls to the FastAPI backend */
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${backendUrl}/:path*`,
      },
    ];
  },
  images: {
    remotePatterns: [
      {
        protocol: "http",
        hostname: backendHost,
        port: backendPort,
      },
    ],
    unoptimized: true,
  },
};

export default nextConfig;

