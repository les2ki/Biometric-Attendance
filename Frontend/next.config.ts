import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  experimental: { // Next 16 preview features
    instantInsights: { // dev-time instant-navigation checks
      validationLevel: "manual-warning", // the dashboard is client-rendered behind a login (spec U2); only validate segments that opt in with `export const instant`
    },
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
