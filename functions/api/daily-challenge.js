import {
  getAuthenticatedUsername,
  isSameOriginRequest
} from "./_user-auth.js";

const json = (data, status = 200, extraHeaders = {}) => Response.json(data, {
  status,
  headers: { "Cache-Control": "no-store", ...extraHeaders }
});

const GUEST_COOKIE = "obh_daily_guest";
const GUEST_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

function readCookie(request, name) {
  const cookieHeader = request.headers.get("Cookie") || "";
  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() === name) {
      return part.slice(separator + 1).trim();
    }
  }
  return "";
}

function createGuestToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return [...bytes].map(value => value.toString(16).padStart(2, "0")).join("");
}

async function hashGuestToken(token) {
  const bytes = new TextEncoder().encode(token);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, "0")).join("");
}

function guestCookieHeader(token) {
  return `${GUEST_COOKIE}=${token}; Path=/; Max-Age=${GUEST_COOKIE_MAX_AGE}; HttpOnly; Secure; SameSite=Lax`;
}

async function getGuestIdentity(request) {
  const existing = readCookie(request, GUEST_COOKIE);
  if (/^[a-f0-9]{64}$/.test(existing)) {
    return { hash: await hashGuestToken(existing), setCookie: null };
  }
  const token = createGuestToken();
  return { hash: await hashGuestToken(token), setCookie: guestCookieHeader(token) };
}
const utcDate = () => new Date().toISOString().slice(0, 10);

function parseOptions(value) {
  let options = value;
  if (typeof options === "string") {
    try { options = JSON.parse(options); } catch { return null; }
  }
  if (!Array.isArray(options) || options.length !== 4 ||
      options.some(x => typeof x !== "string" || !x.trim())) return null;
  return options;
}

async function getActiveChallenge(db) {
  const date = utcDate();
  const challenge = await db.prepare(`
    SELECT challenge_id, challenge_date, title, question_count, status
    FROM daily_challenges
    WHERE challenge_type = 'daily' AND challenge_date = ?
      AND status IN ('scheduled', 'active')
    LIMIT 1
  `).bind(date).first();
  if (!challenge) return null;
  if (challenge.status !== "active") {
    await db.prepare(`
      UPDATE daily_challenges
      SET status = 'active', activated_at = COALESCE(activated_at, CURRENT_TIMESTAMP)
      WHERE challenge_id = ? AND status = 'scheduled'
    `).bind(challenge.challenge_id).run();
  }
  return { ...challenge, status: "active" };
}

async function getChallengeQuestions(db, challengeId) {
  const { results } = await db.prepare(`
    SELECT q.id, q.subject, q.category, q.topic, q.level, q.difficulty,
           q.question, q.options, dcq.position
    FROM daily_challenge_questions dcq
    JOIN questions q ON q.id = dcq.question_id
    WHERE dcq.challenge_id = ?
    ORDER BY dcq.position ASC
  `).bind(challengeId).all();
  return results.map(row => ({
    id: row.id, subject: row.subject, category: row.category,
    topic: row.topic, level: row.level, difficulty: row.difficulty,
    question: row.question, options: parseOptions(row.options),
    position: row.position
  })).filter(q => q.options);
}

async function getAttempt(db, challengeId, username) {
  return db.prepare(`
    SELECT attempt_id, status, started_at, completed_at, score,
           hearts_remaining, xp_awarded, xp_earned, answers_json, current_position
    FROM challenge_attempts
    WHERE challenge_id = ? AND username = ?
  `).bind(challengeId, username).first();
}

async function startAttempt(db, challenge, username) {
  const attemptId = crypto.randomUUID();
  await db.prepare(`
    INSERT OR IGNORE INTO challenge_attempts
      (attempt_id, challenge_id, username, status, started_at, answers_json,
       score, hearts_remaining, current_position, xp_awarded, xp_earned)
    VALUES (?, ?, ?, 'in_progress', CURRENT_TIMESTAMP, '[]', 0, 3, 0, 0, 0)
  `).bind(attemptId, challenge.challenge_id, username).run();
  return getAttempt(db, challenge.challenge_id, username);
}

async function getGuestAttempt(db, challengeId, guestHash) {
  return db.prepare(`
    SELECT attempt_id, status, started_at, completed_at, score,
           hearts_remaining, xp_earned, answers_json, current_position
    FROM guest_challenge_attempts
    WHERE challenge_id = ? AND guest_hash = ?
  `).bind(challengeId, guestHash).first();
}

async function startGuestAttempt(db, challenge, guestHash) {
  const attemptId = crypto.randomUUID();
  await db.prepare(`
    INSERT OR IGNORE INTO guest_challenge_attempts
      (attempt_id, challenge_id, guest_hash, status, started_at, answers_json,
       score, hearts_remaining, current_position, xp_earned)
    VALUES (?, ?, ?, 'in_progress', CURRENT_TIMESTAMP, '[]', 0, 3, 0, 0)
  `).bind(attemptId, challenge.challenge_id, guestHash).run();
  return getGuestAttempt(db, challenge.challenge_id, guestHash);
}

async function recordGuestAnswer(db, challengeId, guestHash, body) {
  const { attemptId, questionId, selectedIndex, position } = body;
  if (typeof attemptId !== "string" || typeof questionId !== "string" ||
      !Number.isInteger(selectedIndex) || selectedIndex < 0 || selectedIndex > 3 ||
      !Number.isInteger(position) || position < 1 || position > 5) {
    return json({ error: "Invalid answer submission." }, 400);
  }

  const attempt = await db.prepare(`
    SELECT attempt_id, status, answers_json, score, hearts_remaining, current_position
    FROM guest_challenge_attempts
    WHERE attempt_id = ? AND challenge_id = ? AND guest_hash = ?
  `).bind(attemptId, challengeId, guestHash).first();
  if (!attempt) return json({ error: "Challenge attempt not found." }, 404);
  if (attempt.status !== "in_progress") return json({ error: "This attempt is already completed." }, 409);
  if (Number(attempt.current_position) !== position - 1) {
    return json({ error: "This question has already been answered or is out of sequence. Refresh to resume." }, 409);
  }

  const question = await db.prepare(`
    SELECT q.correct, q.explanation, q.hint, dcq.position
    FROM daily_challenge_questions dcq
    JOIN questions q ON q.id = dcq.question_id
    WHERE dcq.challenge_id = ? AND dcq.question_id = ? AND dcq.position = ?
  `).bind(challengeId, questionId, position).first();
  if (!question) return json({ error: "Question does not belong to this challenge." }, 400);

  const isCorrect = selectedIndex === Number(question.correct);
  const newScore = Number(attempt.score) + (isCorrect ? 1 : 0);
  const newHearts = Math.max(0, Number(attempt.hearts_remaining) - (isCorrect ? 0 : 1));
  let previousAnswers = [];
  try { previousAnswers = JSON.parse(attempt.answers_json || "[]"); } catch {}
  const answers = [...previousAnswers, { questionId, selectedIndex, correct: isCorrect }];
  const update = await db.prepare(`
    UPDATE guest_challenge_attempts
    SET answers_json = ?, score = ?, hearts_remaining = ?, current_position = ?, xp_earned = ?
    WHERE attempt_id = ? AND challenge_id = ? AND guest_hash = ?
      AND status = 'in_progress' AND current_position = ?
  `).bind(
    JSON.stringify(answers), newScore, newHearts, position, newScore * 30,
    attemptId, challengeId, guestHash, position - 1
  ).run();

  if (!update.meta || update.meta.changes !== 1) {
    return json({ error: "This answer was already recorded in another tab. Refresh to continue." }, 409);
  }
  return json({
    success: true, guest: true, correct: isCorrect, score: newScore,
    heartsRemaining: newHearts, xpEarned: newScore * 30,
    explanation: question.explanation || question.hint || "",
    nextPosition: position + 1, finished: newHearts === 0 || position === 5
  });
}

async function finishGuestAttempt(db, challengeId, guestHash, attemptId) {
  if (typeof attemptId !== "string" || attemptId.length > 80) {
    return json({ error: "Invalid attempt ID." }, 400);
  }
  const attempt = await db.prepare(`
    SELECT attempt_id, status, score, hearts_remaining, current_position, xp_earned
    FROM guest_challenge_attempts
    WHERE attempt_id = ? AND challenge_id = ? AND guest_hash = ?
  `).bind(attemptId, challengeId, guestHash).first();
  if (!attempt) return json({ error: "Challenge attempt not found." }, 404);
  if (attempt.status === "completed") {
    return json({
      success: true, guest: true, alreadyCompleted: true,
      score: attempt.score, totalQuestions: 5,
      heartsRemaining: attempt.hearts_remaining, xpEarned: attempt.xp_earned,
      xpAwarded: false
    });
  }
  if (attempt.status !== "in_progress" ||
      !(Number(attempt.current_position) === 5 || Number(attempt.hearts_remaining) === 0)) {
    return json({ error: "Complete all five questions or lose all three hearts before finishing." }, 409);
  }
  const score = Number(attempt.score);
  const hearts = Number(attempt.hearts_remaining);
  const xpEarned = score * 30;
  await db.prepare(`
    UPDATE guest_challenge_attempts
    SET status = 'completed', completed_at = CURRENT_TIMESTAMP, xp_earned = ?
    WHERE attempt_id = ? AND challenge_id = ? AND guest_hash = ?
      AND status = 'in_progress'
      AND (current_position = 5 OR hearts_remaining = 0)
  `).bind(xpEarned, attemptId, challengeId, guestHash).run();
  const saved = await db.prepare(`
    SELECT score, hearts_remaining, xp_earned
    FROM guest_challenge_attempts
    WHERE attempt_id = ? AND challenge_id = ? AND guest_hash = ?
  `).bind(attemptId, challengeId, guestHash).first();
  return json({
    success: true, guest: true, score: saved?.score ?? score,
    totalQuestions: 5, heartsRemaining: saved?.hearts_remaining ?? hearts,
    xpEarned: saved?.xp_earned ?? xpEarned, xpAwarded: false
  });
}

async function recordAnswer(db, challengeId, username, body) {
  const { attemptId, questionId, selectedIndex, position } = body;
  if (typeof attemptId !== "string" || typeof questionId !== "string" ||
      !Number.isInteger(selectedIndex) || selectedIndex < 0 || selectedIndex > 3 ||
      !Number.isInteger(position) || position < 1 || position > 5) {
    return json({ error: "Invalid answer submission." }, 400);
  }

  const attempt = await db.prepare(`
    SELECT attempt_id, status, answers_json, score, hearts_remaining, current_position
    FROM challenge_attempts
    WHERE attempt_id = ? AND challenge_id = ? AND username = ?
  `).bind(attemptId, challengeId, username).first();
  if (!attempt) return json({ error: "Challenge attempt not found." }, 404);
  if (attempt.status !== "in_progress") return json({ error: "This attempt is already completed." }, 409);
  if (Number(attempt.current_position) !== position - 1) {
    return json({ error: "This question has already been answered or is out of sequence. Refresh to resume." }, 409);
  }

  const question = await db.prepare(`
    SELECT q.correct, q.explanation, q.hint, dcq.position
    FROM daily_challenge_questions dcq
    JOIN questions q ON q.id = dcq.question_id
    WHERE dcq.challenge_id = ? AND dcq.question_id = ? AND dcq.position = ?
  `).bind(challengeId, questionId, position).first();
  if (!question) return json({ error: "Question does not belong to this challenge." }, 400);

  const isCorrect = selectedIndex === Number(question.correct);
  const newScore = Number(attempt.score) + (isCorrect ? 1 : 0);
  const newHearts = Math.max(0, Number(attempt.hearts_remaining) - (isCorrect ? 0 : 1));
  let previousAnswers = [];
  try { previousAnswers = JSON.parse(attempt.answers_json || "[]"); } catch {}
  const answers = [...previousAnswers, {
    questionId, selectedIndex, correct: isCorrect
  }];

  const update = await db.prepare(`
    UPDATE challenge_attempts
    SET answers_json = ?, score = ?, hearts_remaining = ?, current_position = ?
    WHERE attempt_id = ? AND challenge_id = ? AND username = ?
      AND status = 'in_progress' AND current_position = ?
  `).bind(
    JSON.stringify(answers), newScore, newHearts, position,
    attemptId, challengeId, username, position - 1
  ).run();

  if (!update.meta || update.meta.changes !== 1) {
    return json({ error: "This answer was already recorded in another tab. Refresh to continue." }, 409);
  }

  return json({
    success: true,
    correct: isCorrect,
    score: newScore,
    heartsRemaining: newHearts,
    xpEarned: newScore * 30,
    explanation: question.explanation || question.hint || "",
    nextPosition: position + 1,
    finished: newHearts === 0 || position === 5
  });
}

async function finishAttempt(db, challengeId, username, attemptId) {
  if (typeof attemptId !== "string" || attemptId.length > 80) {
    return json({ error: "Invalid attempt ID." }, 400);
  }
  const attempt = await db.prepare(`
    SELECT attempt_id, status, score, hearts_remaining, current_position,
           xp_earned, xp_awarded
    FROM challenge_attempts
    WHERE attempt_id = ? AND challenge_id = ? AND username = ?
  `).bind(attemptId, challengeId, username).first();
  if (!attempt) return json({ error: "Challenge attempt not found." }, 404);

  if (attempt.status === "completed") {
    return json({
      success: true, alreadyCompleted: true,
      score: attempt.score, totalQuestions: 5,
      heartsRemaining: attempt.hearts_remaining,
      xpEarned: attempt.xp_earned, xpAwarded: Boolean(attempt.xp_awarded)
    });
  }
  if (attempt.status !== "in_progress" ||
      !(Number(attempt.current_position) === 5 || Number(attempt.hearts_remaining) === 0)) {
    return json({ error: "Complete all five questions or lose all three hearts before finishing." }, 409);
  }

  const score = Number(attempt.score);
  const hearts = Number(attempt.hearts_remaining);
  const xpEarned = score * 30;

  await db.batch([
    db.prepare(`
      UPDATE challenge_attempts
      SET status = 'completed', completed_at = CURRENT_TIMESTAMP, xp_earned = ?
      WHERE attempt_id = ? AND challenge_id = ? AND username = ?
        AND status = 'in_progress'
        AND (current_position = 5 OR hearts_remaining = 0)
    `).bind(xpEarned, attemptId, challengeId, username),

    db.prepare(`
      UPDATE users
      SET xp = COALESCE(xp, 0) + ?,
          progress_data = json_set(
            COALESCE(progress_data, '{}'),
            '$."Daily Challenge"',
            json_set(
              COALESCE(json_extract(progress_data, '$."Daily Challenge"'), '{}'),
              '$."Daily Challenge"',
              json_patch(
                COALESCE(json_extract(progress_data, '$."Daily Challenge"."Daily Challenge"'), '{}'),
                json_object(
                  'xp', COALESCE(json_extract(progress_data, '$."Daily Challenge"."Daily Challenge".xp'), 0) + ?,
                  'plays', COALESCE(json_extract(progress_data, '$."Daily Challenge"."Daily Challenge".plays'), 0) + 1,
                  'best_score', MAX(COALESCE(json_extract(progress_data, '$."Daily Challenge"."Daily Challenge".best_score'), 0), ?),
                  'best_score_total', 5,
                  'max_hearts', MAX(COALESCE(json_extract(progress_data, '$."Daily Challenge"."Daily Challenge".max_hearts'), 0), ?)
                )
              )
            )
          )
      WHERE username = ?
        AND EXISTS (
          SELECT 1 FROM challenge_attempts
          WHERE attempt_id = ? AND status = 'completed' AND xp_awarded = 0
        )
    `).bind(xpEarned, xpEarned, score, hearts, username, attemptId),

    db.prepare(`
      UPDATE challenge_attempts
      SET xp_awarded = 1
      WHERE attempt_id = ? AND status = 'completed' AND xp_awarded = 0
    `).bind(attemptId)
  ]);

  const saved = await db.prepare(`
    SELECT score, hearts_remaining, xp_earned, xp_awarded, status
    FROM challenge_attempts WHERE attempt_id = ? AND username = ?
  `).bind(attemptId, username).first();

  return json({
    success: true,
    score: saved?.score ?? score,
    totalQuestions: 5,
    heartsRemaining: saved?.hearts_remaining ?? hearts,
    xpEarned: saved?.xp_earned ?? xpEarned,
    xpAwarded: Boolean(saved?.xp_awarded)
  });
}

export async function onRequest({ request, env }) {
  if (!env.DB) return json({ error: "Database binding DB is unavailable." }, 503);
  try {
    const challenge = await getActiveChallenge(env.DB);
    if (!challenge) return json({ error: "Today's Daily Challenge is not available yet. Please try again shortly." }, 404);

    if (request.method === "GET") {
      const questions = await getChallengeQuestions(env.DB, challenge.challenge_id);
      if (questions.length !== 5) return json({ error: "Today's challenge is being prepared. Please try again shortly." }, 503);
      const username = await getAuthenticatedUsername(request, env);
      let attempt = null;
      let guest = false;
      let cookieHeader = null;
      if (username) {
        attempt = await getAttempt(env.DB, challenge.challenge_id, username);
      } else {
        const identity = await getGuestIdentity(request);
        attempt = await getGuestAttempt(env.DB, challenge.challenge_id, identity.hash);
        guest = true;
        cookieHeader = identity.setCookie;
      }
      let savedAnswers = [];
      try { savedAnswers = JSON.parse(attempt?.answers_json || "[]"); } catch {}
      const headers = cookieHeader ? { "Set-Cookie": cookieHeader } : {};
      return json({
        challenge: {
          id: challenge.challenge_id, date: challenge.challenge_date,
          title: challenge.title, questionCount: 5, status: "active"
        },
        guest,
        attempt: attempt ? {
          id: attempt.attempt_id, status: attempt.status,
          score: attempt.score, heartsRemaining: attempt.hearts_remaining,
          xpEarned: attempt.xp_earned, currentPosition: attempt.current_position,
          answers: savedAnswers
        } : null,
        questions
      }, 200, headers);
    }

    if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
    if (!isSameOriginRequest(request)) return json({ error: "Forbidden origin." }, 403);
    const body = await request.json();
    if (!body || typeof body.action !== "string") return json({ error: "Invalid request." }, 400);

    const username = await getAuthenticatedUsername(request, env);
    if (username) {
      if (body.action === "start") {
        const attempt = await startAttempt(env.DB, challenge, username);
        const questions = await getChallengeQuestions(env.DB, challenge.challenge_id);
        if (questions.length !== 5) return json({ error: "The challenge question set is incomplete." }, 503);
        let answers = [];
        try { answers = JSON.parse(attempt.answers_json || "[]"); } catch {}
        return json({
          success: true, guest: false,
          attempt: {
            id: attempt.attempt_id, status: attempt.status,
            score: attempt.score, heartsRemaining: attempt.hearts_remaining,
            xpEarned: attempt.xp_earned, currentPosition: attempt.current_position,
            answers
          },
          questions
        });
      }
      if (body.action === "answer") return recordAnswer(env.DB, challenge.challenge_id, username, body);
      if (body.action === "finish") return finishAttempt(env.DB, challenge.challenge_id, username, body.attemptId);
      return json({ error: "Unknown action." }, 400);
    }

    const guestToken = readCookie(request, GUEST_COOKIE);
    if (!/^[a-f0-9]{64}$/.test(guestToken)) {
      return json({ error: "Your guest session is being prepared. Please refresh the page and try again." }, 401);
    }
    const guestHash = await hashGuestToken(guestToken);
    if (body.action === "start") {
      const attempt = await startGuestAttempt(env.DB, challenge, guestHash);
      const questions = await getChallengeQuestions(env.DB, challenge.challenge_id);
      if (questions.length !== 5) return json({ error: "The challenge question set is incomplete." }, 503);
      let answers = [];
      try { answers = JSON.parse(attempt.answers_json || "[]"); } catch {}
      return json({
        success: true, guest: true,
        attempt: {
          id: attempt.attempt_id, status: attempt.status,
          score: attempt.score, heartsRemaining: attempt.hearts_remaining,
          xpEarned: attempt.xp_earned, currentPosition: attempt.current_position,
          answers
        },
        questions
      });
    }
    if (body.action === "answer") return recordGuestAnswer(env.DB, challenge.challenge_id, guestHash, body);
    if (body.action === "finish") return finishGuestAttempt(env.DB, challenge.challenge_id, guestHash, body.attemptId);
    return json({ error: "Unknown action." }, 400);
  } catch (error) {
    console.error("Daily Challenge API error:", error);
    return json({ error: "The Daily Challenge request could not be completed." }, 500);
  }
}
