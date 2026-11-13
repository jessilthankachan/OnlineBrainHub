const DAY_MS = 24 * 60 * 60 * 1000;
const QUESTION_COUNT = 5;
const SCHEDULE_DAYS = 5;

function dateAtOffset(offset) {
  return new Date(Date.now() + offset * DAY_MS).toISOString().slice(0, 10);
}

function parseOptions(value) {
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    return Array.isArray(parsed) &&
      parsed.length === 4 &&
      parsed.every(item => typeof item === "string" && item.trim())
      ? parsed : null;
  } catch {
    return null;
  }
}

function shuffle(items) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

// Mixed selection: establish subject variety first, add a level variety where
// available, then fill the remaining slots randomly from the complete pool.
function chooseQuestions(pool, count) {
  const shuffled = shuffle(pool);
  const chosen = [];
  const used = new Set();

  const add = item => {
    if (!item || used.has(item.id) || chosen.length >= count) return false;
    chosen.push(item);
    used.add(item.id);
    return true;
  };

  const subjects = [...new Set(shuffled.map(q => q.subject).filter(Boolean))];
  for (const subject of shuffle(subjects)) {
    if (chosen.length >= Math.min(3, count)) break;
    add(shuffle(shuffled.filter(q => q.subject === subject && !used.has(q.id)))[0]);
  }

  const levels = [...new Set(shuffled.map(q => q.level).filter(Boolean))];
  for (const level of shuffle(levels)) {
    if (chosen.length >= 4) break;
    if (!chosen.some(q => q.level === level)) {
      add(shuffle(shuffled.filter(q => q.level === level && !used.has(q.id)))[0]);
    }
  }

  for (const item of shuffled) {
    if (chosen.length >= count) break;
    add(item);
  }
  return chosen;
}

async function getEligiblePool(db) {
  const { results } = await db.prepare(`
    SELECT id, subject, level, question, options, correct
    FROM questions
    WHERE question IS NOT NULL
      AND TRIM(question) <> ''
      AND correct BETWEEN 0 AND 3
      AND CASE
        WHEN json_valid(options)
        THEN json_type(options) = 'array' AND json_array_length(options) = 4
        ELSE 0
      END
  `).all();

  return results.filter(q => {
    const options = parseOptions(q.options);
    return options && Number.isInteger(Number(q.correct)) &&
      Number(q.correct) >= 0 && Number(q.correct) <= 3;
  });
}

async function getAlreadyScheduledQuestionIds(db, fromDate, toDate) {
  const { results } = await db.prepare(`
    SELECT dcq.question_id
    FROM daily_challenge_questions dcq
    JOIN daily_challenges dc ON dc.challenge_id = dcq.challenge_id
    WHERE dc.challenge_type = 'daily'
      AND dc.challenge_date BETWEEN ? AND ?
  `).bind(fromDate, toDate).all();
  return new Set(results.map(row => row.question_id));
}

async function ensureSchedule(db) {
  const today = new Date().toISOString().slice(0, 10);
  const lastDate = dateAtOffset(SCHEDULE_DAYS - 1);

  await db.prepare(`
    UPDATE daily_challenges
    SET status = 'active',
        activated_at = COALESCE(activated_at, CURRENT_TIMESTAMP)
    WHERE challenge_type = 'daily'
      AND challenge_date = ?
      AND status = 'scheduled'
  `).bind(today).run();

  await db.prepare(`
    UPDATE daily_challenges
    SET status = 'completed'
    WHERE challenge_type = 'daily'
      AND challenge_date < ?
      AND status IN ('scheduled', 'active')
  `).bind(today).run();

  const pool = await getEligiblePool(db);
  if (pool.length < QUESTION_COUNT) {
    throw new Error(`Only ${pool.length} eligible questions are available; five are required.`);
  }

  const assigned = await getAlreadyScheduledQuestionIds(db, today, lastDate);
  for (let offset = 0; offset < SCHEDULE_DAYS; offset++) {
    const challengeDate = dateAtOffset(offset);
    const challengeId = `daily:${challengeDate}`;
    const exists = await db.prepare(`
      SELECT challenge_id FROM daily_challenges WHERE challenge_id = ?
    `).bind(challengeId).first();
    if (exists) continue;

    let available = pool.filter(q => !assigned.has(q.id));
    // If the pool cannot supply 25 unique questions, reuse is allowed rather
    // than leaving a date without a challenge.
    if (available.length < QUESTION_COUNT) available = pool;

    const selected = chooseQuestions(available, QUESTION_COUNT);
    if (selected.length !== QUESTION_COUNT) {
      throw new Error(`Could not select five questions for ${challengeDate}.`);
    }

    const status = offset === 0 ? "active" : "scheduled";
    const statements = [
      db.prepare(`
        INSERT OR IGNORE INTO daily_challenges
          (challenge_id, challenge_type, challenge_date, title, question_count,
           status, generated_at, activated_at)
        VALUES (?, 'daily', ?, 'Daily Brain Sprint', 5, ?, CURRENT_TIMESTAMP,
                CASE WHEN ? = 'active' THEN CURRENT_TIMESTAMP ELSE NULL END)
      `).bind(challengeId, challengeDate, status, status)
    ];

    selected.forEach((q, index) => {
      statements.push(db.prepare(`
        INSERT OR IGNORE INTO daily_challenge_questions
          (challenge_id, position, question_id)
        SELECT ?, ?, ?
        WHERE EXISTS (
          SELECT 1 FROM daily_challenges
          WHERE challenge_id = ? AND challenge_date = ?
        )
      `).bind(challengeId, index + 1, q.id, challengeId, challengeDate));
    });

    await db.batch(statements);
    selected.forEach(q => assigned.add(q.id));
  }

  return { today, scheduledThrough: lastDate, eligibleQuestions: pool.length };
}

export default {
  async scheduled(controller, env, ctx) {
    if (!env.DB) throw new Error("D1 binding DB is missing. Configure it as DB.");
    const result = await ensureSchedule(env.DB);
    console.log("Daily Challenge schedule checked:", JSON.stringify(result));
  },

  // Optional manual health check after deployment.
  async fetch(request, env) {
    if (!env.DB) return Response.json({ error: "D1 binding DB is missing." }, { status: 503 });
    if (new URL(request.url).pathname !== "/health") {
      return new Response("Not found", { status: 404 });
    }
    return Response.json({ ok: true, service: "obh-daily-challenge-scheduler" });
  }
};
