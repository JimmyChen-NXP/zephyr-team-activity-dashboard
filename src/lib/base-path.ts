function normalizeBasePath(value: string): string {
  if (!value) {
    return "";
  }

  const normalized = value.startsWith("/") ? value : `/${value}`;
  return normalized.endsWith("/") ? normalized.slice(0, -1) : normalized;
}

export function getPublicBasePath(): string {
  return normalizeBasePath(process.env.NEXT_PUBLIC_BASE_PATH ?? "");
}

export function withBasePath(href: string): string {
  const basePath = getPublicBasePath();
  if (!basePath) {
    return href;
  }

  if (href.startsWith("http://") || href.startsWith("https://")) {
    return href;
  }

  if (!href.startsWith("/")) {
    return `${basePath}/${href}`;
  }

  if (href === basePath || href.startsWith(`${basePath}/`)) {
    return href;
  }

  return `${basePath}${href}`;
}
