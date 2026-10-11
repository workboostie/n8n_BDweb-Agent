export const SESSION_COOKIE = "fbp_session";
const MAX_AGE_DAYS = 30;

const enc = new TextEncoder();

function secret() {
  return process.env.SESSION_SECRET || process.env.DASHBOARD_SECRET || "";
}

async function sign(msg: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(msg));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function createSessionToken() {
  const exp = String(Date.now() + MAX_AGE_DAYS * 86_400_000);
  return `${exp}.${await sign(exp)}`;
}

export async function verifySessionToken(token: string | undefined) {
  if (!token || !secret()) return false;
  const [exp, sig] = token.split(".");
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  return sig === (await sign(exp));
}

export const sessionMaxAge = MAX_AGE_DAYS * 86_400;
