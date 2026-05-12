import type { NextConfig } from 'next';

const config: NextConfig = {
  reactStrictMode: true,
  // Pull TS files from ../shared into the Next.js compile graph.
  typescript: {
    tsconfigPath: './tsconfig.json'
  }
};

export default config;
