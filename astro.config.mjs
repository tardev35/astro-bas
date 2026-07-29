// @ts-check
import { defineConfig } from "astro/config";

import tailwindcss from "@tailwindcss/vite";

import sitemap from "@astrojs/sitemap";

// https://astro.build/config
export default defineConfig({
  vite: {
    plugins: [tailwindcss()],
  },

  build: {
    inlineStylesheets: "always",
  },

  redirects: {
    "/line": "https://tinyurl.com/suhng",
  },

  site: "https://winup888-brand.com",
  integrations: [
    sitemap({
      // /login, /register and /line are forwarding pages that all ship
      // noindex. Listing a noindex URL in the sitemap is a contradiction —
      // it asks Google to crawl a page it is simultaneously told to drop, and
      // Search Console reports it as "Submitted URL marked noindex". These
      // three are also the only pages carrying the affiliate and LINE short
      // links, so there is nothing here to gain from the crawl either.
      filter: (page) => !/\/(login|register|line)\/?$/.test(page),
    }),
  ],
});
