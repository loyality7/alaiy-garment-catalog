import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* Proxy API calls to the FastAPI backend */
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: "http://localhost:8000/:path*",
      },
    ];
  },
  images: {
    remotePatterns: [
      {
        protocol: "http",
        hostname: "localhost",
        port: "8000",
      },
    ],
    unoptimized: true,
  },
};

export default nextConfig;
