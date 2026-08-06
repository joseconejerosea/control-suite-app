const nextConfig = {
  output: "standalone" as const,
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${process.env.BACKEND_INTERNAL_URL ?? "http://localhost:3001"}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;