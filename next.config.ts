import type { NextConfig } from "next";

const isGitHubPagesBuild = process.env.DEPLOY_TARGET === "github-pages";

function resolveGitHubPagesBasePath(): string {
  const explicit = process.env.GITHUB_PAGES_BASE_PATH;
  if (explicit) {
    return explicit.startsWith("/") ? explicit.replace(/\/$/, "") : `/${explicit.replace(/\/$/, "")}`;
  }

  const repo = process.env.GITHUB_REPOSITORY;
  const repoName = repo?.split("/")[1];
  if (!repoName) {
    return "";
  }

  return `/${repoName}`;
}

const nextConfig: NextConfig = {
  typedRoutes: true,
  ...(isGitHubPagesBuild
    ? (() => {
        const basePath = resolveGitHubPagesBasePath();
        if (!basePath) {
          throw new Error("GitHub Pages build requires GITHUB_REPOSITORY or GITHUB_PAGES_BASE_PATH to compute basePath.");
        }

        return {
          output: "export",
          basePath,
          assetPrefix: basePath,
          trailingSlash: true,
          images: { unoptimized: true },
        } satisfies NextConfig;
      })()
    : {}),
};

export default nextConfig;
