-- OnlineBrainHub Daily Challenge schema.
-- Apply this migration to the existing D1 database only after reviewing it.

CREATE TABLE IF NOT EXISTS daily_challenges (
  challenge_id TEXT PRIMARY KEY,
  challenge_type TEXT NOT NULL DEFAULT 'daily',
  challenge_date TEXT NOT NULL,
  title TEXT NOT NULL,
  subject TEXT,
  level TEXT,
  question_count INTEGER NOT NULL DEFAULT 5 CHECK (question_count > 0),
  status TEXT NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('scheduled', 'active', 'completed')),
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  generated_at DATETIME,
  activated_at DATETIME
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_daily_challenges_general_date
ON daily_challenges (challenge_date)
WHERE challenge_type = 'daily' AND subject IS NULL AND level IS NULL;

CREATE INDEX IF NOT EXISTS idx_daily_challenges_status_date
ON daily_challenges (status, challenge_date);

CREATE TABLE IF NOT EXISTS daily_challenge_questions (
  challenge_id TEXT NOT NULL,
  position INTEGER NOT NULL CHECK (position BETWEEN 1 AND 5),
  question_id TEXT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (challenge_id, position),
  UNIQUE (challenge_id, question_id),
  FOREIGN KEY (challenge_id) REFERENCES daily_challenges(challenge_id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_daily_challenge_questions_question
ON daily_challenge_questions (question_id);

CREATE TABLE IF NOT EXISTS challenge_attempts (
  attempt_id TEXT PRIMARY KEY,
  challenge_id TEXT NOT NULL,
  username TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'in_progress'
    CHECK (status IN ('in_progress', 'completed')),
  started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at DATETIME,
  answers_json TEXT NOT NULL DEFAULT '[]',
  score INTEGER NOT NULL DEFAULT 0 CHECK (score BETWEEN 0 AND 5),
  hearts_remaining INTEGER NOT NULL DEFAULT 3 CHECK (hearts_remaining BETWEEN 0 AND 3),
  current_position INTEGER NOT NULL DEFAULT 0 CHECK (current_position BETWEEN 0 AND 5),
  xp_earned INTEGER NOT NULL DEFAULT 0 CHECK (xp_earned BETWEEN 0 AND 150),
  xp_awarded INTEGER NOT NULL DEFAULT 0 CHECK (xp_awarded IN (0, 1)),
  UNIQUE (challenge_id, username),
  FOREIGN KEY (challenge_id) REFERENCES daily_challenges(challenge_id)
    ON DELETE CASCADE,
  FOREIGN KEY (username) REFERENCES users(username)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_challenge_attempts_user
ON challenge_attempts (username, started_at);
