import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // the microphone needs permission from this site only
  async headers() {
    return [{ source: "/(.*)", headers: [{ key: "Permissions-Policy", value: "microphone=(self)" }] }];
  },
};

export default nextConfig;
