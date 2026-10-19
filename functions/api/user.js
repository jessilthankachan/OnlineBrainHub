export async function onRequestPost(context) {
  try {
    const data = await context.request.json();
    const db = context.env.DB;

    if (data.action !== 'save_xp' && data.action !== 'get_profile') {
      if (!data.turnstileToken) throw new Error("Please complete the bot check.");
      const tsData = new FormData();
      tsData.append('secret', context.env.TURNSTILE_SECRET);
      tsData.append('response', data.turnstileToken);
      const tsRes = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: tsData });
      const tsOutcome = await tsRes.json();
      if (!tsOutcome.success) throw new Error("Bot verification failed!");
    }

    async function hash(text) {
      if (!text) return "";
      const msgBuffer = new TextEncoder().encode(text.toLowerCase().trim());
      const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    }

    function generateRecoveryKey() {
      return 'OBH-' + crypto.randomUUID().split('-')[0].toUpperCase() + '-' + crypto.randomUUID().split('-')[1].toUpperCase();
    }

    // 1. REGISTER
    if (data.action === 'register') {
      const passHash = await hash(data.password);
      const hintHash = await hash(data.hintAnswer);
      const rawRecoveryKey = generateRecoveryKey();
      const recoveryHash = await hash(rawRecoveryKey);
      
      try {
        await db.prepare("INSERT INTO users (username, password_hash, security_question, security_answer_hash, recovery_key_hash) VALUES (?, ?, ?, ?, ?)")
                .bind(data.username, passHash, data.hintQuestion, hintHash, recoveryHash).run();
        return Response.json({ success: true, username: data.username, xp: 0, recoveryKey: rawRecoveryKey });
      } catch (e) {
        return Response.json({ error: "Username already taken!" }, { status: 400 });
      }
    } 
    
    // 2. LOGIN (Now uses Password)
    else if (data.action === 'login') {
      const passHash = await hash(data.password);
      const user = await db.prepare("SELECT * FROM users WHERE username = ?").bind(data.username).first();
      
      if (!user || user.password_hash !== passHash) {
        return Response.json({ error: "Invalid username or password!" }, { status: 401 });
      }
      return Response.json({ success: true, username: user.username, xp: user.xp });
    }

    // 3. RECOVER (Uses Hint OR Recovery Key)
    else if (data.action === 'recover') {
      const user = await db.prepare("SELECT * FROM users WHERE username = ?").bind(data.username).first();
      if (!user) return Response.json({ error: "User not found!" }, { status: 404 });

      const hintHash = await hash(data.hintAnswer);
      const recoveryHash = await hash(data.recoveryKey);
      
      if ((data.hintAnswer && user.security_answer_hash === hintHash) || 
          (data.recoveryKey && user.recovery_key_hash === recoveryHash)) {
        
        const newPassHash = await hash(data.newPassword);
        await db.prepare("UPDATE users SET password_hash = ? WHERE username = ?")
                .bind(newPassHash, data.username).run();
        return Response.json({ success: true, username: user.username, xp: user.xp });
      }
      return Response.json({ error: "Invalid Hint Answer or Recovery Key!" }, { status: 401 });
    }

    // 4. GET PROFILE
    else if (data.action === 'get_profile') {
      const user = await db.prepare("SELECT xp, progress_data FROM users WHERE username = ?").bind(data.username).first();
      if (!user) return Response.json({ error: "User not found" }, { status: 404 });
      let parsedProgress = {};
      try { parsedProgress = JSON.parse(user.progress_data || '{}'); } catch(e){}
      return Response.json({ success: true, xp: user.xp, progress: parsedProgress });
    }

    // 5. SAVE XP (Added fail-safes so undefined values don't break the save)
    else if (data.action === 'save_xp') {
      const user = await db.prepare("SELECT progress_data FROM users WHERE username = ?").bind(data.username).first();
      let prog = {};
      try { prog = JSON.parse(user.progress_data || '{}'); } catch(e){}

      if (data.subject && data.topic) {
        if (!prog[data.subject]) prog[data.subject] = {};
        if (!prog[data.subject][data.topic]) {
          prog[data.subject][data.topic] = { xp: 0, plays: 0, best_score: 0, best_score_total: 0, max_hearts: 0 };
        }
        
        prog[data.subject][data.topic].xp += parseInt(data.xpEarned || 0);
        prog[data.subject][data.topic].plays += 1;
        
        if (data.score !== undefined && !isNaN(data.score)) {
          if (data.score > (prog[data.subject][data.topic].best_score || 0)) {
            prog[data.subject][data.topic].best_score = parseInt(data.score);
            prog[data.subject][data.topic].best_score_total = parseInt(data.totalQuestions || 0);
          }
        }
        
        if (data.hearts !== undefined && !isNaN(data.hearts)) {
          if (data.hearts > (prog[data.subject][data.topic].max_hearts || 0)) {
            prog[data.subject][data.topic].max_hearts = parseInt(data.hearts);
          }
        }
      }

      await db.prepare("UPDATE users SET xp = xp + ?, progress_data = ? WHERE username = ?")
              .bind(parseInt(data.xpEarned || 0), JSON.stringify(prog), data.username).run();
              
      return Response.json({ success: true });
    }

    return Response.json({ error: "Invalid request" }, { status: 400 });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}