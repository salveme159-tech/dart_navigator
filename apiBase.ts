/**
 * The API is same-origin by default for local/full-stack hosting.
 * Set VITE_API_BASE_URL at build time only when the static frontend and
 * Express API are deployed to different origins (use an https URL).
 */
const configuredBase = (import.meta.env.VITE_API_BASE_URL ?? "").trim();
export const apiBaseUrl = configuredBase.replace(/\/+$/, "");
export const apiUrl = (path: string) => `${apiBaseUrl}${path.startsWith("/") ? path : `/${path}`}`;
