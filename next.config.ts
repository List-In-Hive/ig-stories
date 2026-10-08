import type { NextConfig } from 'next';
const config: NextConfig = {
  serverExternalPackages: ['@resvg/resvg-js', 'fontkit', 'sharp', 'ffmpeg-static'],
  devIndicators: false,
  agentRules: false,
  // Avoid replaying cached compiler failures from restricted local builds.
  experimental: { turbopackFileSystemCacheForBuild: false },
  outputFileTracingIncludes: { '/*': ['./public/fonts/*.ttf', './migrations/*.sql'] },
};
export default config;
