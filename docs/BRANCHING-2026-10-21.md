# Promoting work while EPGL 2.0 sits on staging

*21 October 2026.*

## What changed

Until today `staging` and `main` were the same commit, and promoting to
production was a fast-forward. EPGL 2.0 is now merged into `staging` and must
not reach production until Salesforce's side is settled — so the two branches
have diverged on purpose, and **a fast-forward of `main` to `staging` would
ship EPGL 2.0 by accident.**

Meanwhile bugs and enhancements on both agents still have to reach production.
The NXN callback work is the live example: it is wanted in production as soon
as Emirates Post whitelist our domains, and it cannot wait for 2.0.

## The rule

```
                    ┌── merge ──► staging   (verify here)
fix branch off main ┤
                    └── merge ──► main      (when Emre asks)
```

1. **Branch off `main`**, never off `staging`. `main` is the production
   lineage; a branch taken from `staging` carries EPGL 2.0 with it.
2. **Merge it into `staging`** and verify there, as always.
3. **When Emre asks, merge the SAME branch into `main`.** Same commits reach
   both branches, so there is nothing to cherry-pick and nothing to diverge.

Delete the branch once it is in both.

## What not to do

- **Do not fast-forward `main` to `staging`.** That is the habit from before
  today and it now ships EPGL 2.0.
- **Do not cherry-pick** a commit from `staging` to `main`. It works once, and
  then the same change exists under two different commit ids, which makes every
  later merge between the branches a conflict resolution against itself.
- **Do not branch a fix off `staging`.** See rule 1.

## The NXN callback work, which was already on staging before the merge

`41632af` (the browser CAPTCHA token) and its three doc commits landed on
`staging` **before** EPGL 2.0 did, so they sit below the merge in the history.
They do not need any of the above: promoting them is still a clean
fast-forward, because `c50bfef` is the last commit before the 2.0 merge.

```
git checkout main && git merge c50bfef --ff-only && git push origin main
```

`git log --oneline main..c50bfef` first — it should list the four callback
commits and nothing else. This is what to run when Emirates Post add our
domains to their Turnstile site key and the callback is ready to go live.

## When EPGL 2.0 does go to production

Merge `staging` into `main` normally. The fixes that travelled the route above
are already in both branches, so the merge carries only 2.0 itself.

## Checking before you promote

`git log --oneline main..<branch>` should list only the fix. If it lists
anything with "EPGL 2.0" in it, the branch was taken off the wrong base.
