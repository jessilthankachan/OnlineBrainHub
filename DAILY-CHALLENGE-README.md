# OnlineBrainHub Daily Challenge implementation

This package was prepared from the supplied OnlineBrainHub ZIP and the D1 schema/binding details supplied in chat.

## Files added

- `migrations/0001_daily_challenge.sql` — three new tables and indexes.
- `functions/api/daily-challenge.js` — active challenge, start attempt, finish attempt API.
- `challenge-loader.html` — standalone Daily Challenge page.
- `daily-challenge-worker/src/index.js` — five-day rolling schedule generator.
- `wrangler.daily-challenge.toml` — separate Worker configuration, using the confirmed D1 database ID.
- `DAILY-CHALLENGE-SETUP.md` — deployment and verification instructions.

## Important review note

The server intentionally does not return correct-answer indexes to the browser. It calculates the score and XP from submitted answers. XP is 30 per correct answer (15 base × 2). Wrong answers consume one of three hearts and award no XP, matching the newer `quiz-loader.html` Daily mode.

The attempt is resumable if the learner refreshes before completion. The database unique constraint allows only one attempt per username per daily challenge. Completion and XP award are guarded by a transactional D1 batch and an `xp_awarded` flag.

The scheduler creates today's challenge and the next four UTC dates. It tries to avoid reusing questions across those five scheduled dates. It selects a diverse set by subject where possible, adds a different level where available, and fills remaining positions randomly from the complete eligible question pool. It permits reuse only if fewer than 25 distinct eligible questions remain.

## Files deliberately preserved

- `functions/api/questions.js`
- `functions/api/questions-new.js`
- `functions/api/user.js`
- `functions/api/_user-auth.js`
- `quiz.html`
- `quiz-loader.html`
- Existing question, options and users tables

The homepage Daily Challenge link is redirected to `/challenge-loader.html`. The old `quiz.html?subject=Daily` path is no longer used by the homepage.

## Before deployment

Review `DAILY-CHALLENGE-SETUP.md`. Apply the SQL migration to the existing D1 database before deploying the Pages Function or scheduler Worker. Do not run it against a different database.
