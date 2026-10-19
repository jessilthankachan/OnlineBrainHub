export async function onRequestPost(context) {
  try {
    const data = await context.request.json();
    const db = context.env.DB;

    // Skip Turnstile ONLY for saving XP or loading profile
    if (data.action !== 'save_xp' && data.action !== 'get_profile') {
      if (!data.turnstileToken) throw new Error("Please complete the bot check.");
      
      const tsData = new FormData();
      tsData.append('secret', context.env.TURNSTILE_SECRET);
      tsData.append('response', data.turnstileToken);
      
      const tsRes = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: tsData });
      const tsOutcome = await tsRes.json();
      if (!tsOutcome.success) throw new Error("Bot verification failed!");
    }

    // Helper: Hash passwords and keys
    async function hash(text) {
      const msgBuffer = new TextEncoder().encode(text.toLowerCase().trim());
      const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    }

    // Helper: Generate a random Recovery Key (e.g. OBH-4F9A-2B1C)
    function generateRecoveryKey() {
      return 'OBH-' + crypto.randomUUID().split('-')[0].toUpperCase() + '-' + crypto.randomUUID().split('-')[1].toUpperCase();
    }

    // 1. CREATE ACCOUNT (Updated with Recovery Key)
    if (data.action === 'register') {
      const answerHash = await hash(data.securityAnswer);
      const rawRecoveryKey = generateRecoveryKey();
      const recoveryHash = await hash(rawRecoveryKey);
      
      try {
        await db.prepare("INSERT INTO users (username, security_question, security_answer_hash, recovery_key_hash) VALUES (?, ?, ?, ?)")
                .bind(data.username, data.securityQuestion, answerHash, recoveryHash).run();
        // We return the raw key ONLY THIS ONE TIME so the user can copy it
        return Response.json({ success: true, username: data.username, xp: 0, recoveryKey: rawRecoveryKey });
      } catch (e) {
        return Response.json({ error: "Username already taken! Choose another." }, { status: 400 });
      }
    } 
    
    // 2. LOAD SAVE (LOGIN)
    else if (data.action === 'login') {
      const answerHash = await hash(data.securityAnswer);
      const user = await db.prepare("SELECT * FROM users WHERE username = ?").bind(data.username).first();
      
      if (!user || user.security_answer_hash !== answerHash) {
        return Response.json({ error: "Invalid username or secret answer!" }, { status: 401 });
      }
      return Response.json({ success: true, username: user.username, xp: user.xp });
    }

    // 3. ACCOUNT RECOVERY (NEW)
    else if (data.action === 'recover') {
      const recoveryHash = await hash(data.recoveryKey);
      const user = await db.prepare("SELECT * FROM users WHERE username = ?").bind(data.username).first();
      
      if (!user || user.recovery_key_hash !== recoveryHash) {
        return Response.json({ error: "Invalid Username or Recovery Key!" }, { status: 401 });
      }
      
      // If the key matches, lock in their new secret answer
      const newAnswerHash = await hash(data.newSecurityAnswer);
      await db.prepare("UPDATE users SET security_question = ?, security_answer_hash = ? WHERE username = ?")
              .bind(data.newSecurityQuestion, newAnswerHash, data.username).run();
              
      return Response.json({ success: true, username: user.username, xp: user.xp });
    }

    // 4. LOAD PROFILE STATS
    else if (data.action === 'get_profile') {
      const user = await db.prepare("SELECT xp, progress_data FROM users WHERE username = ?").bind(data.username).first();
      if (!user) return Response.json({ error: "User not found" }, { status: 404 });
      
      let parsedProgress = {};
      try { parsedProgress = JSON.parse(user.progress_data || '{}'); } catch(e){}
      
      return Response.json({ success: true, xp: user.xp, progress: parsedProgress });
    }

    // 5. SAVE XP PROGRESS
    else if (data.action === 'save_xp') {
      const user = await db.prepare("SELECT progress_data FROM users WHERE username = ?").bind(data.username).first();
      let prog = {};
      try { prog = JSON.parse(user.progress_data || '{}'); } catch(e){}

      if (data.subject && data.topic) {
        if (!prog[data.subject]) prog[data.subject] = {};
        if (!prog[data.subject][data.topic]) prog[data.subject][data.topic] = { xp: 0, plays: 0 };
        prog[data.subject][data.topic].xp += parseInt(data.xpEarned);
        prog[data.subject][data.topic].plays += 1;
      }

      await db.prepare("UPDATE users SET xp = xp + ?, progress_data = ? WHERE username = ?")
              .bind(parseInt(data.xpEarned), JSON.stringify(prog), data.username).run();
              
      return Response.json({ success: true });
    }

    return Response.json({ error: "Invalid request" }, { status: 400 });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}