import type { Config } from "@react-router/dev/config";

import { sentryOnBuildEnd } from "@sentry/react-router";
import { vercelPreset } from "@vercel/react-router/vite";

declare module "react-router" {
  interface Future {
    unstable_middleware: true;
  }
}

export default {
  ssr: true,
  async prerender() {
    return ["/sitemap.xml", "/robots.txt"];
  },
  presets: [
    ...(process.env.VERCEL ? [vercelPreset()] : []),
  ],
  buildEnd: async ({ viteConfig, reactRouterConfig, buildManifest }) => {
    if (
      process.env.SENTRY_ORG &&
      process.env.SENTRY_PROJECT &&
      process.env.SENTRY_AUTH_TOKEN
    ) {
      await sentryOnBuildEnd({
        viteConfig,
        reactRouterConfig,
        buildManifest,
      });
    }
  },
} satisfies Config;
