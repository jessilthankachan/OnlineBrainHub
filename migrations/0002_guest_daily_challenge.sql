-- Add guest attempts without changing existing logged-in challenge_attempts.
-- Apply this migration once to the existing obh_qn_db D1 database.

CREATE TABLE IF NOT EXISTS guest_challenge_attempts (
  attempt_id TEXT PRIMARY KEY,
  challenge_id TEXT NOT NULL,
  guest_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'in_progress'
    CHECK (status IN ('in_progress', 'completed')),
  started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at DATETIME,
  answers_json TEXT NOT NULL DEFAULT '[]',
  score INTEGER NOT NULL DEFAULT 0 CHECK (score BETWEEN 0 AND 5),
  hearts_remaining INTEGER NOT NULL DEFAULT 3 CHECK (hearts_remaining BETWEEN 0 AND 3),
  current_position INTEGER NOT NULL DEFAULT 0 CHECK (current_position BETWEEN 0 AND 5),
  xp_earned INTEGER NOT NULL DEFAULT 0 CHECK (xp_earned BETWEEN 0 AND 150),
  UNIQUE (challenge_id, guest_hash),
  FOREIGN KEY (challenge_id) REFERENCES daily_challenges(challenge_id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_guest_challenge_attempts_session
ON guest_challenge_attempts (guest_hash, started_at);
