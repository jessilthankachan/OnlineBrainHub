export async function onRequestPost(context) {
  try {
    const data = await context.request.json();

    // 1. Verify Turnstile Bot Protection
    if (!data.turnstileToken) throw new Error("Please complete the bot check.");
    const tsData = new FormData();
    tsData.append('secret', context.env.TURNSTILE_SECRET);
    tsData.append('response', data.turnstileToken);
    const tsRes = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: tsData });
    const tsOutcome = await tsRes.json();
    if (!tsOutcome.success) throw new Error("Bot verification failed!");

    // 2. Verify Master Password
    const correctPassword = context.env.ADMIN_PASS;
    if (!correctPassword) throw new Error("Admin password not configured in Cloudflare.");
    
    if (data.password === correctPassword) {
      // Generate a simple session token
      const sessionToken = "obh_admin_" + crypto.randomUUID();
      return Response.json({ success: true, token: sessionToken });
    } else {
      return Response.json({ error: "Incorrect Master Password" }, { status: 401 });
    }
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}