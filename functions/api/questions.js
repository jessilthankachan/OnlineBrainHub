export async function onRequestGet(context) {
  try {
    // Fetch everything directly from the new unified table
    const { results } = await context.env.DB.prepare("SELECT * FROM questions").all();
    
    return Response.json(results);
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}

export async function onRequestPost(context) {
  try {
    const data = await context.request.json();
    
    // Convert the options array into a JSON string to store in the single table
    const optionsString = typeof data.options === 'string' ? data.options : JSON.stringify(data.options);

    // Insert directly into our new database structure
    await context.env.DB.prepare(
      `INSERT INTO questions (id, subject, category, topic, level, difficulty, question, options, correct, hint, explanation) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      data.id, 
      data.subject, 
      data.category, 
      data.topic, 
      data.level, 
      parseInt(data.difficulty), 
      data.question, 
      optionsString, 
      parseInt(data.correct), 
      data.hint, 
      data.explanation
    ).run();

    return Response.json({ success: true });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}