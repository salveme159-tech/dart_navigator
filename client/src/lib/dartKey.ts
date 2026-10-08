const SESSION_KEY = "dn-opendart-key-session";
const LOCAL_KEY = "dn-opendart-key-local";
const LEGACY_KEY = "dn-opendart-key";

function safeGet(storage: Storage, key: string) {
  try { return storage.getItem(key) ?? ""; } catch { return ""; }
}
function safeSet(storage: Storage, key: string, value: string) {
  try { storage.setItem(key, value); } catch { /* ignore */ }
}
function safeRemove(storage: Storage, key: string) {
  try { storage.removeItem(key); } catch { /* ignore */ }
}

export function getStoredDartKey() {
  if (typeof window === "undefined") return "";
  const session = safeGet(window.sessionStorage, SESSION_KEY).trim();
  if (session) return session;
  return safeGet(window.localStorage, LOCAL_KEY).trim();
}

export function saveDartKey(key: string, remember: boolean) {
  if (typeof window === "undefined") return;
  const value = key.trim();
  safeRemove(window.localStorage, LEGACY_KEY);
  safeRemove(window.sessionStorage, SESSION_KEY);
  safeRemove(window.localStorage, LOCAL_KEY);
  if (!value) return;
  safeSet(window.sessionStorage, SESSION_KEY, value);
  if (remember) safeSet(window.localStorage, LOCAL_KEY, value);
}

export function clearDartKey() {
  if (typeof window === "undefined") return;
  safeRemove(window.sessionStorage, SESSION_KEY);
  safeRemove(window.localStorage, LOCAL_KEY);
  safeRemove(window.localStorage, LEGACY_KEY);
}

export function hasDartKey() {
  return Boolean(getStoredDartKey());
}

export function validateDartKeyFormat(key: string) {
  return /^[A-Za-z0-9]{40}$/.test(key.trim());
}
