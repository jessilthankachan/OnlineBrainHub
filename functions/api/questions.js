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
    const url = new URL(request.url);

    // ==========================================
    // GET: Smart Server-Side Filtering
    // ==========================================
    if (request.method === 'GET') {
      const subject = url.searchParams.get('subject');
      const category = url.searchParams.get('category');
      
      let sql = "SELECT * FROM questions";
      let bindParams = [];
      let conditions = [];

      // If the frontend asks for a specific subject, add it to the SQL query
      if (subject && subject !== 'Daily') {
        conditions.push("subject = ?");
        bindParams.push(subject);
      }
      
      // If the frontend asks for a specific category, add it to the SQL query
      if (category) {
        conditions.push("category = ?");
        bindParams.push(category);
      }

      // Combine conditions, or apply a safety limit if fetching everything (e.g., Admin Panel)
      if (conditions.length > 0) {
        sql += " WHERE " + conditions.join(" AND ");
      } else {
        sql += " ORDER BY id DESC LIMIT 1000"; // Prevents 503s on the Admin panel by capping the load
      }

      const { results } = await env.DB.prepare(sql).bind(...bindParams).all();
      
      return new Response(JSON.stringify(results), { 
        status: 200, 
        headers: { 'Content-Type': 'application/json', ...corsHeaders } 
      });
    }

    // ==========================================
    // POST, PUT, DELETE remain raw and fast
    // ==========================================
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