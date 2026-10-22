const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // GET: ZERO CPU PROCESSING. Raw database dump straight to the browser.
    if (request.method === 'GET') {
      const { results } = await env.DB.prepare("SELECT * FROM questions").all();
      
      return new Response(JSON.stringify(results), { 
        status: 200, 
        headers: { 'Content-Type': 'application/json', ...corsHeaders } 
      });
    }

    // POST: Raw insert (Admin)
    if (request.method === 'POST') {
      const body = await request.json();
      await env.DB.prepare(
        `INSERT INTO questions (id, subject, category, topic, level, difficulty, question, options, correct, explanation, hint) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        body.id, body.subject, body.category, body.topic, body.level, body.difficulty, 
        body.question, JSON.stringify(body.options), body.correct, body.explanation, body.hint
      ).run();
      
      return new Response(JSON.stringify({ success: true }), { status: 201, headers: corsHeaders });
    }

    // PUT: Raw update (Admin)
    if (request.method === 'PUT') {
      const body = await request.json();
      await env.DB.prepare(
        `UPDATE questions SET subject=?, category=?, topic=?, level=?, difficulty=?, question=?, options=?, correct=?, explanation=?, hint=? WHERE id=?`
      ).bind(
        body.subject, body.category, body.topic, body.level, body.difficulty, 
        body.question, JSON.stringify(body.options), body.correct, body.explanation, body.hint, body.id
      ).run();
      
      return new Response(JSON.stringify({ success: true }), { status: 200, headers: corsHeaders });
    }

    // DELETE: Raw delete (Admin)
    if (request.method === 'DELETE') {
      const body = await request.json();
      await env.DB.prepare("DELETE FROM questions WHERE id = ?").bind(body.id).run();
      return new Response(JSON.stringify({ success: true }), { status: 200, headers: corsHeaders });
    }

    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: corsHeaders });

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: corsHeaders });
  }
}