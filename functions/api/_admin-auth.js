const encoder = new TextEncoder();
const COOKIE = "obh_admin_session";
const SESSION_SECONDS = 30 * 60;

function b64url(bytes) {
  let s = ""; for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
async function sign(value, secret) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64url(new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(value))));
}
export async function issueAdminCookie(secret) {
  const payload = b64url(encoder.encode(JSON.stringify({ role: "admin", exp: Math.floor(Date.now()/1000) + SESSION_SECONDS, nonce: crypto.randomUUID() })));
  const token = payload + "." + await sign(payload, secret);
  return `${COOKIE}=${token}; HttpOnly; Secure; SameSite=Strict; Path=/api/; Max-Age=${SESSION_SECONDS}`;
}
export async function isAdminRequest(request, env) {
  if (!env.ADMIN_SESSION_SECRET || env.ADMIN_SESSION_SECRET.length < 32) return false;
  const cookie = request.headers.get("Cookie") || "";
  const token = cookie.split(";").map(x=>x.trim()).find(x=>x.startsWith(COOKIE+"="))?.slice(COOKIE.length+1);
  if (!token) return false;
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra) return false;
  const expected = await sign(payload, env.ADMIN_SESSION_SECRET);
  if (signature.length !== expected.length) return false;
  let diff = 0; for (let i=0;i<signature.length;i++) diff |= signature.charCodeAt(i) ^ expected.charCodeAt(i);
  if (diff !== 0) return false;
  try { const data = JSON.parse(atob(payload.replace(/-/g,"+").replace(/_/g,"/"))); return data.role === "admin" && Number.isInteger(data.exp) && data.exp > Math.floor(Date.now()/1000); } catch { return false; }
}
export const clearAdminCookie = `${COOKIE}=; HttpOnly; Secure; SameSite=Strict; Path=/api/; Max-Age=0`;
export function sameOrigin(request) {
  const origin = request.headers.get("Origin");
  return !origin || origin === new URL(request.url).origin;
}
