import { issueAdminCookie, clearAdminCookie } from "./_admin-auth.js";

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    if (request.headers.get("Origin") && request.headers.get("Origin") !== new URL(request.url).origin) return Response.json({error:"Forbidden origin"},{status:403});
    if (!env.ADMIN_PASS || !env.ADMIN_SESSION_SECRET || env.ADMIN_SESSION_SECRET.length < 32 || !env.TURNSTILE_SECRET) return Response.json({error:"Admin security is not configured. Contact the site administrator."},{status:503});
    const data = await request.json();
    if (typeof data.password !== "string" || data.password.length > 256 || typeof data.turnstileToken !== "string") return Response.json({error:"Invalid login request"},{status:400});
    const form = new FormData(); form.append("secret", env.TURNSTILE_SECRET); form.append("response", data.turnstileToken);
    const verify = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {method:"POST", body:form});
    const result = await verify.json();
    if (!result.success || (result.hostname && result.hostname !== new URL(request.url).hostname)) return Response.json({error:"Bot verification failed"},{status:401});
    const a = new TextEncoder().encode(data.password), b = new TextEncoder().encode(env.ADMIN_PASS);
    let diff = a.length ^ b.length; for(let i=0;i<Math.max(a.length,b.length);i++) diff |= (a[i]||0) ^ (b[i]||0);
    if (diff !== 0) return Response.json({error:"Incorrect password"},{status:401});
    return new Response(JSON.stringify({success:true}), {status:200, headers:{"Content-Type":"application/json","Cache-Control":"no-store","Set-Cookie":await issueAdminCookie(env.ADMIN_SESSION_SECRET)}});
  } catch { return Response.json({error:"Login failed"},{status:400}); }
}
export async function onRequestDelete() { return new Response(null,{status:204,headers:{"Set-Cookie":clearAdminCookie,"Cache-Control":"no-store"}}); }
