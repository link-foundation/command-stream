export function hasNpmBadge(body) {
  return [...body.matchAll(/!\[[^\]]*\]\((https?:\/\/[^\s)]+)\)/g)].some(
    ([, target]) => {
      try {
        const url = new URL(target);
        return (
          url.protocol === 'https:' &&
          url.hostname === 'img.shields.io' &&
          url.pathname.startsWith('/badge/npm-')
        );
      } catch {
        return false;
      }
    }
  );
}
