import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  allowedDevOrigins: [
    "localhost",
    "127.0.0.1",
    // Allow preview panel cross-origin requests
    ".space-z.ai",
    // Allow any preview/chat subdomain
    ".space-z.ai:3000",
  ],
  // V3.4.4: Reduce number of concurrent chunk requests
  // by bundling everything into fewer chunks
  experimental: {
    optimizePackageImports: [
      'lucide-react',
      '@dnd-kit/core',
      '@dnd-kit/sortable',
      '@dnd-kit/utilities',
    ],
  },
  // V3.0: Vercel production optimization
  // No output: 'export' by default — use Vercel's Node.js runtime
  // API routes work with force-dynamic for fresh data
  // Static export can be done temporarily for Netlify builds
};

export default nextConfig;
