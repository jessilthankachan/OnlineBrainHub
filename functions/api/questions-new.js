// Dedicated ID-based question endpoint for Middle, High and Higher Secondary.
// The legacy /api/questions endpoint remains unchanged for Primary quizzes.

const ALLOWED_LEVELS = new Set(["ms", "hs", "hss"]);
const ALLOWED_SUBJECTS = new Set(["math", "phy", "chem", "bio", "geo", "hist"]);
const ALLOWED_DIFFICULTIES = new Set(["1", "5", "10"]);

function json(data, status = 200) {
  return Response.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8"
    }
  });
}

export async function onRequestGet({ request, env }) {
  try {
    if (!env.DB) return json({ error: "Question database is unavailable." }, 503);

    const params = new URL(request.url).searchParams;
    const subject = (params.get("subject") || "").trim().toLowerCase();
    const category = (params.get("category") || "").trim();
    const level = (params.get("level") || "").trim().toLowerCase();
    const topicId = (params.get("topic_id") || "").trim();
    const subtopicId = (params.get("subtopic_id") || "").trim();
    const difficulty = (params.get("difficulty") || "").trim();

    if (!ALLOWED_SUBJECTS.has(subject)) return json({ error: "Invalid or missing subject code." }, 400);
    if (!category || category.length > 120) return json({ error: "Invalid or missing category." }, 400);
    if (!ALLOWED_LEVELS.has(level)) return json({ error: "Invalid or missing school level." }, 400);
    if (!new RegExp(`^${level}_${subject}_t\\d{2}$`).test(topicId)) {
      return json({ error: "Invalid or missing topic ID." }, 400);
    }
    if (subtopicId && !new RegExp(`^${level}_${subject}_t\\d{2}_st\\d{2}$`).test(subtopicId)) {
      return json({ error: "Invalid subtopic ID." }, 400);
    }
    if (subtopicId && !subtopicId.startsWith(topicId + "_st")) {
      return json({ error: "The subtopic ID does not belong to the supplied topic ID." }, 400);
    }
    if (difficulty && !ALLOWED_DIFFICULTIES.has(difficulty)) {
      return json({ error: "Difficulty must be 1, 5 or 10." }, 400);
    }

    // Column order aligns with the D1 indexes:
    // (subject, level, topic_id, subtopic_id, difficulty)
    // (subject, level, topic_id, difficulty)
    const conditions = [
      "subject = ?",
      "LOWER(category) = LOWER(?)",
      "level = ?",
      "topic_id = ?"
    ];
    const values = [subject, category, level, topicId];

    if (subtopicId) {
      conditions.push("subtopic_id = ?");
      values.push(subtopicId);
    }
    if (difficulty) {
      conditions.push("difficulty = ?");
      values.push(Number(difficulty));
    }

    const sql = `
      SELECT id, subject, category, topic, level, difficulty,
             question, options, correct, explanation, hint,
             topic_id, subtopic_id
      FROM questions
      WHERE ${conditions.join(" AND ")}
      ORDER BY RANDOM()
      LIMIT 10
    `;

    const result = await env.DB.prepare(sql).bind(...values).all();
    return json(result.results || []);
  } catch (error) {
    console.error("ID-based question retrieval failed:", error);
    return json({ error: "Unable to retrieve quiz questions." }, 500);
  }
}
