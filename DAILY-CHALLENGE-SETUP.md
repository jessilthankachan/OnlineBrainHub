# Daily Challenge setup and deployment

## 1. What this implementation uses

- Existing Cloudflare Pages project.
- Existing Pages D1 binding named `DB`.
- Existing D1 database `obh_qn_db`.
- Existing learner session cookie and `USER_SESSION_SECRET`.
- Existing `questions.options` JSON array and `questions.correct` zero-based answer index.

No existing quiz API or question/user table is changed.

## 2. Review and apply the D1 migration

Open Cloudflare Dashboard → Workers & Pages → D1 → `obh_qn_db` → Console.

First inspect whether the three tables already exist:

```sql
SELECT name FROM sqlite_master
WHERE type='table'
  AND name IN ('daily_challenges','daily_challenge_questions','challenge_attempts');
```

If none exist, copy and run `migrations/0001_daily_challenge.sql` in the D1 Console. The migration only creates the three new tables and their indexes.

Then verify:

```sql
SELECT name, sql
FROM sqlite_master
WHERE type='table'
  AND name IN ('daily_challenges','daily_challenge_questions','challenge_attempts')
ORDER BY name;
```

Do not run against another D1 database.

## 3. Deploy Pages changes

Copy the new `functions/api/daily-challenge.js` into the Pages project at the same path. Copy `challenge-loader.html` to the project root. The updated `index.html` points the homepage CTA to `/challenge-loader.html`.

Deploy the Pages project using the same deployment method you currently use. The existing Pages D1 binding must remain named `DB`. `USER_SESSION_SECRET` must remain configured as a Pages secret (the existing login API already requires it).

## 4. Deploy the scheduled Worker

The scheduler is separate from Pages because Pages Functions do not run Cron Triggers.

The supplied `wrangler.daily-challenge.toml` uses the D1 database ID supplied in the Cloudflare dashboard URL and the existing binding name `DB`.

From the `daily-challenge-worker` directory, place the TOML file at that directory's root (or run Wrangler with its `--config` path adjusted), then deploy:

```bash
npx wrangler deploy --config wrangler.daily-challenge.toml
```

The worker folder contains `src/index.js`. If you keep the TOML file at the project root instead, run:

```bash
npx wrangler deploy --config daily-challenge-worker/wrangler.daily-challenge.toml
```

If Wrangler asks for authentication, authenticate with your own Cloudflare account. Do not share API tokens or secrets.

The Cron Trigger is `0 */6 * * *` (every six hours, UTC). It maintains today's active challenge and four future UTC dates.

## 5. Initial schedule generation

After the Worker is deployed, open Workers & Pages → `obh-daily-challenge-scheduler` → Settings → Triggers and confirm the Cron Trigger exists. Wait for its first scheduled run, or use Wrangler's local/remote development workflow only if you are comfortable with it.

Check the generated schedule in D1:

```sql
SELECT challenge_date, status, question_count, generated_at
FROM daily_challenges
WHERE challenge_type='daily'
ORDER BY challenge_date;
```

Check the fixed five-question sets:

```sql
SELECT dc.challenge_date, dcq.position, q.id, q.subject, q.level
FROM daily_challenges dc
JOIN daily_challenge_questions dcq ON dcq.challenge_id=dc.challenge_id
JOIN questions q ON q.id=dcq.question_id
WHERE dc.challenge_type='daily'
ORDER BY dc.challenge_date, dcq.position;
```

Each generated date should have exactly five question mappings.

## 6. Test

1. Log in to OnlineBrainHub.
2. Open the homepage and click Play Now in Today's Brain Sprint.
3. Confirm the challenge displays five questions and three hearts.
4. Complete the challenge and verify the score and XP.
5. Refresh or reopen the page. The same user must see the completed result, not a new attempt.
6. Test with a second learner account. They should see the same five questions in the same order but have their own attempt.
7. Confirm the normal topic/subtopic quiz flows still work.

Useful attempt audit:

```sql
SELECT challenge_id, username, status, score, hearts_remaining,
       xp_earned, xp_awarded, started_at, completed_at
FROM challenge_attempts
ORDER BY started_at DESC
LIMIT 20;
```

## 7. Important behavior and limitations

- The daily date is UTC, not India local time.
- Question selection validates four non-empty string options and `correct` in the range 0–3.
- The current eligible bank contains 8,869 rows, but the scheduler dynamically checks the current eligible pool.
- The scheduler does not use the old `/api/questions` 1,000-row response.
- If fewer than 25 distinct eligible questions are available for the rolling five-day window, question reuse is allowed.
- Existing legacy `/quiz.html?subject=Daily` behavior remains in the code but is no longer linked from the homepage.
- The scheduler must be deployed and its D1 binding must be named `DB`.
- The current API uses `getAuthenticatedUsername` from the existing signed session helper; it does not trust a username sent by the browser.
- No database migration, Pages deployment, Worker deployment, or live data mutation has been performed as part of preparing this package.
