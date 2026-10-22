const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function onRequest(context) {
  const { request, env } = context;

  // 1. Handle CORS Preflight
  if (request.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // GET: Ultra-fast raw fetch (Bypasses 503 CPU limits)
    if (request.method === 'GET') {
      const { results } = await env.DB.prepare("SELECT * FROM questions").all();
      
      return new Response(JSON.stringify(results), { 
        status: 200, 
        headers: { 'Content-Type': 'application/json', ...corsHeaders } 
      });
    }

    // POST: Add new question
    if (request.method === 'POST') {
      const body = await request.json();
      const optionsStr = JSON.stringify(body.options);
      
      await env.DB.prepare(
        `INSERT INTO questions (id, subject, category, topic, level, difficulty, question, options, correct, explanation, hint) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        body.id, body.subject, body.category, body.topic, body.level, body.difficulty, 
        body.question, optionsStr, body.correct, body.explanation, body.hint
      ).run();
      
      return new Response(JSON.stringify({ success: true }), { 
        status: 201, 
        headers: { 'Content-Type': 'application/json', ...corsHeaders } 
      });
    }

    // PUT: Edit existing question
    if (request.method === 'PUT') {
      const body = await request.json();
      const optionsStr = JSON.stringify(body.options);
      
      await env.DB.prepare(
        `UPDATE questions SET subject=?, category=?, topic=?, level=?, difficulty=?, question=?, options=?, correct=?, explanation=?, hint=? WHERE id=?`
      ).bind(
        body.subject, body.category, body.topic, body.level, body.difficulty, 
        body.question, optionsStr, body.correct, body.explanation, body.hint, body.id
      ).run();
      
      return new Response(JSON.stringify({ success: true }), { 
        status: 200, 
        headers: { 'Content-Type': 'application/json', ...corsHeaders } 
      });
    }

    // DELETE: Remove question via Body ID
    if (request.method === 'DELETE') {
      const body = await request.json();
      if (!body.id) throw new Error("No ID provided");
      
      await env.DB.prepare("DELETE FROM questions WHERE id = ?").bind(body.id).run();
      
      return new Response(JSON.stringify({ success: true }), { 
        status: 200, 
        headers: { 'Content-Type': 'application/json', ...corsHeaders } 
      });
    }

    return new Response(JSON.stringify({ error: "Method not allowed" }), { 
      status: 405, 
      headers: { 'Content-Type': 'application/json', ...corsHeaders } 
    });

  } catch (error) {
    // Send the exact error back to the browser if something crashes
    return new Response(JSON.stringify({ error: error.message }), { 
      status: 500, 
      headers: { 'Content-Type': 'application/json', ...corsHeaders } 
    });
  }
}