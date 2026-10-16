# Contributing

Thanks for considering it. This is a small project, so expectations are set
deliberately low to keep review fast.

## Getting it running

```bash
git clone https://github.com/arjav1181/Go.git
cd Go
npm ci
cp .env.example .env.local    # fill in Supabase values
npm run dev
```

You need a Supabase project with every migration in `supabase/migrations/`
applied, in filename order. See the README.

## Before you open a pull request

All four must pass. CI runs them too, but catching it locally is faster.

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

## Adding a database change

1. Create the next numbered file in `supabase/migrations/`. Never edit an
   applied migration.
2. It must be safe to run against a database that already has the previous
   files, and safe to run twice (`if not exists`, `drop … if exists`).
3. Add a check constraint for anything that will be written by user input.
4. Enable row level security on any new table. There are no policies by
   design: all access goes through the service role.

## Style

- TypeScript, no `any`.
- Comments explain **why**, not what. The diff already says what.
- Prefer a named export over a default export.
- Keep the redirect path free of new database round trips. It is the hot path.
  If you must add one, say so in the pull request.

## Things that need discussion first

- Changing how analytics aggregate, or what is collected. This is a privacy
  product; storage decisions are not refactors.
- Making accounts open to anyone.
- Adding a dependency that is fetched at runtime from another origin. The CSP
  deliberately allows no third-party origins.

## Reporting bugs

GitHub issues. Include what you expected, what happened, and the relevant part
of the logs if you have them. For anything security-shaped, do not open a public
issue — see `SECURITY.md`.