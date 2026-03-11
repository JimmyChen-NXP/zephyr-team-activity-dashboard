export type DeployTarget = "local" | "github-pages";

export function getDeployTarget(): DeployTarget {
  const target = process.env.NEXT_PUBLIC_DEPLOY_TARGET ?? process.env.DEPLOY_TARGET ?? "local";
  return target === "github-pages" ? "github-pages" : "local";
}

export function isGitHubPagesTarget(): boolean {
  return getDeployTarget() === "github-pages";
}
