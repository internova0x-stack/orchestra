import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The system prompt is read from prompts/ at runtime; ship it with the server functions.
  outputFileTracingIncludes: { "/api/chat": ["./prompts/**/*"] },
  serverExternalPackages: ["postgres"],
};

export default nextConfig;
