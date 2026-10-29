const configuredBase = (
  import.meta.env.VITE_API_BASE_URL ?? ""
).trim();

export const apiBaseUrl = configuredBase.replace(/\/+$/, "");

export const apiUrl = (path: string): string =>
  `${apiBaseUrl}${path.startsWith("/") ? path : `/${path}`}`;
