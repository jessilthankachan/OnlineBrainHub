export async function onRequestGet(context) {
  // Fetch all questions and options
  const { results: qResults } = await context.env.DB.prepare("SELECT * FROM questions").all();
  const { results: oResults } = await context.env.DB.prepare("SELECT * FROM options").all();

  // Format them into your exact JSON structure
  const formattedQuestions = qResults.map(q => {
    // Find options for this specific question
    const qOptions = oResults.filter(o => o.question_id === q.id);
    
    // Map out just the text array and find the correct index (0, 1, 2, or 3)
    const optionsArray = qOptions.map(o => o.option_text);
    const correctIndex = qOptions.findIndex(o => o.is_correct === 1);

    return {
      id: q.id,
      subject: q.subject,
      category: q.category,
      topic: q.topic,
      level: q.level,
      difficulty: q.difficulty,
      question: q.question_text,
      options: optionsArray,
      correct: correctIndex,
      explanation: q.explanation,
      hint: q.hint
    };
  });

  return Response.json(formattedQuestions);
}

export async function onRequestPost(context) {
  const data = await context.request.json();
  
  try {
    // 1. Insert the main question data
    await context.env.DB.prepare(
      `INSERT INTO questions (id, subject, category, topic, level, difficulty, question_text, explanation, hint) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      data.id, data.subject, data.category, data.topic, data.level, 
      parseInt(data.difficulty), data.question, data.explanation, data.hint
    ).run();
    
    // 2. Insert the 4 options, marking the correct one based on the index
    await context.env.DB.prepare(
      `INSERT INTO options (question_id, option_text, is_correct) VALUES (?, ?, ?), (?, ?, ?), (?, ?, ?), (?, ?, ?)`
    ).bind(
      data.id, data.options[0], data.correct === 0 ? 1 : 0,
      data.id, data.options[1], data.correct === 1 ? 1 : 0,
      data.id, data.options[2], data.correct === 2 ? 1 : 0,
      data.id, data.options[3], data.correct === 3 ? 1 : 0
    ).run();

    return Response.json({ success: true });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}