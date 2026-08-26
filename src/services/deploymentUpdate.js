const SCRIPT_SRC_PATTERN = /<script\b[^>]*\bsrc=(['"])([^'"]+)\1[^>]*>/gi;

export function getAppEntrypointPath(html, documentUrl) {
  if (typeof html !== 'string' || !documentUrl) return null;

  for (const match of html.matchAll(SCRIPT_SRC_PATTERN)) {
    const pathname = new URL(match[2], documentUrl).pathname;
    if (/\/assets\/index-[^/]+\.js$/i.test(pathname)) {
      return pathname;
    }
  }

  return null;
}

export function hasDeploymentUpdate({ html, documentUrl, currentEntrypointUrl }) {
  const latestEntrypointPath = getAppEntrypointPath(html, documentUrl);
  if (!latestEntrypointPath || !currentEntrypointUrl) return false;
  return latestEntrypointPath !== new URL(currentEntrypointUrl).pathname;
}
