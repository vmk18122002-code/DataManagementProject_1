import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // the disaster portal is now a section of the coordinator portal
  async redirects() {
    return [
      { source: "/disaster", destination: "/coordinator/disaster", permanent: false },
      { source: "/disaster/:path*", destination: "/coordinator/disaster/:path*", permanent: false },
    ];
  },
};

export default nextConfig;
