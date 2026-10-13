# Deploying the cloud edition on AWS

The AWS footprint — Fargate task, EFS, CloudFront, API Gateway, Route 53 —
now lives in a separate private repo, `bassamZakaria/cyag-devops`, under
`apps/mezan`. See that repo's README for bootstrap, first apply, nameserver
delegation, backups and teardown. This repo only builds the app and hands the
result off.

## What this workflow does

`.github/workflows/deploy-aws.yml` runs on every push to `main`, or on
`workflow_dispatch`:

1. Assumes an AWS role over OIDC and logs in to ECR.
2. Builds the `linux/arm64` image and pushes it to ECR, tagged with the
   commit SHA.
3. Builds the web client and syncs `apps/web/dist` to the web bucket, then
   invalidates the CloudFront distribution.
4. Fires a `repository_dispatch` at `cyag-devops` (event type `mezan-deploy`,
   with the image tag and `environment: demo`), which runs `mezan-deploy.yml`
   there to apply the Terraform in `apps/mezan` against the new image.

Steps 2 and 3 talk directly to the AWS resources cyag-devops already stood
up; step 4 is the only coupling between the two repos, and it is one HTTP
call.

A deploy is a gap, not an overlap: the ECS service runs at minimum 0 percent
and maximum 100 percent healthy, so the old task stops before the new one
starts. Every tenant database is a single SQLite file opened in exclusive
locking mode, and a second task would be a second writer.

## Server environment

The task's environment is set in `cyag-devops/apps/mezan/compute.tf`, for the
demo stack and the reviewer stack alike; this repository lists the reviewer
stack's in `docs/DEPLOY-REVIEW.md`. Two variables the server refuses to start
without, on either stack:

- `MEZAN_TRUSTED_PROXY_HOPS=2` beside `MEZAN_TRUST_PROXY=1` (CloudFront, then
  API Gateway).
- `MEZAN_PUBLIC_URL=https://<the stack's domain>` once `MEZAN_SMTP_HOST` is set.

Every variable is described in `docs/ENVIRONMENTS.md`.

## Company databases after a deploy

Nothing is required on deploy day. Nothing is done to a company's database by hand, and no
SQL is run against the platform database.

A company's database is bound to its tenant id when the company is provisioned, and a
database that is bound to another company, missing, unreadable or never claimed by anybody is
refused with a 503 and left byte for byte under the name it had. A database written before
binding existed carries no binding: it is served exactly as it was served before, and no
open, sign-in or restart ever binds it. Such a company is exactly as exposed to a file
swapped on the data volume as it is today, which takes access to the volume itself; every
company provisioned from this build on is bound from birth. Binding a legacy company's books
is one console action, «تأكيد الدفاتر», and doing it for each of them after the deploy is
recommended housekeeping, not a condition of serving them.

The console's company list shows where each company's books stand, as a chip beside its name:

| Chip | Served | What the platform owner does |
|---|---|---|
| «دفاتر مربوطة» (`bound`) | Yes | Nothing. «فك ربط الدفاتر», after typing the company's code, only when a file that is not the company's was bound to it |
| «دفاتر غير مربوطة (قديمة)» (`unbound`) | Yes, as before | Recommended: open the company, press «تأكيد الدفاتر», check the company name and the admins the file holds, pick an admin you know and confirm. If the name shown is another company's, press «ليست دفاتر هذه المنشأة» |
| «دفاتر موقوفة» (`disowned`) | No, 503 | Put the company's own file in place on the data volume, then «تأكيد الدفاتر» |
| «دفاتر منشأة أخرى» (`foreign`) | No, 503 | The file is bound to another company, or holds no account anybody created. Put the company's own file in place |
| «ملف الدفاتر مفقود» (`missing`) | No, 503 | Restore the file from a backup. Nothing is created in its place |
| «ملف دفاتر تالف» (`unreadable`) | No, 503 | Restore the file from a backup |

«تأكيد الدفاتر» binds the books and clears a «دفاتر موقوفة» mark in one write with its
CRITICAL audit row; with no audit row it answers 503 and binds nothing. The books are read
again inside that write and bound only while they still hold the company name and the admin
the dialog showed. The chosen admin becomes the recorded owner only when the company's row
names none; an owner already recorded is not changed. While a company's books are refused,
the console's «تعيين مالك» and «إعادة تعيين رمز المالك» are disabled and say why.

One legacy shape is refused that the build before served: a company that was registered
under the seed admin's own address (`admin@cyag.example`) and whose books hold that account
alone, with no claim recorded. Nobody ever made those books theirs, so they read as `foreign`.
The demo and the reviewer company are not this shape: their seeded accounts make them
`unbound`.

### What the task does at start-up, and what it costs

The task starts serving at once. In the background it then reads every company's books, one
company at a time, without opening one for use, and prints `[cloud] tenant books at start: N
checked: …` followed by one line for each company whose books are refused: `[cloud] tenant
books: "<code>" (<id>) is <standing>`. `/healthz` does not wait for this. A company asked for
before its turn is judged by its own first open.

A database with no log beside it is read in place. A database with a log (`-wal`) beside it,
which is what a task that was killed leaves and what a company being served has, is read from
a private copy under `<data dir>/scratch/` (directory `0700`, files `0600`), removed after
the read and emptied at start-up before anything else. The copy is made off the event loop.
Measured on a developer laptop's SSD, a 182 MB database with a 20 MB log: 168 to 216 ms per
read, of which the longest stall of the event loop was 24 to 48 ms; the synchronous copy this
replaced held the event loop for all of 178 to 269 ms. A stack of 17 small companies with no
logs was ready to serve in 12 to 16 ms and had read all 17 by 126 to 139 ms.

On EFS expect the copy to take far longer than on a local disk: it is a full read and a full
write of the database on network storage, the scratch directory is on the same volume, and
burst credits apply. It no longer delays start-up or other companies, but the console's first
look at a large company after an unclean stop waits for it. The console reads a company's
books again only when the database, its log or its journal has changed since the last read,
so an idle company costs three `stat` calls. A company that is being written to is copied
again on each look at its detail page; the list reads nothing it has read before.

## Repository secrets

| Secret | What it is |
|---|---|
| `AWS_APP_CI_ROLE_ARN` | The OIDC role this workflow assumes to push to ECR, sync S3 and invalidate CloudFront. Created in cyag-devops. |
| `DEVOPS_DISPATCH_TOKEN` | A fine-grained personal access token scoped to `cyag-devops` with `Contents: read and write` — that is what triggering a `repository_dispatch` requires. |

## Repository variables

| Variable | What it is |
|---|---|
| `ECR_REPOSITORY_URL` | `terraform output` of `apps/mezan` in cyag-devops. |
| `WEB_BUCKET` | `terraform output` of `apps/mezan` in cyag-devops. |
| `CLOUDFRONT_DISTRIBUTION_ID` | `terraform output` of `apps/mezan` in cyag-devops. |

Re-read these from `terraform output` in cyag-devops after any apply that
recreates the ECR repository, the web bucket or the distribution, and update
the repository variables here to match.

## Redeploying by hand

```sh
REPO=<ECR_REPOSITORY_URL>
aws ecr get-login-password --region eu-central-1 \
  | docker login --username AWS --password-stdin "${REPO%%/*}"
docker buildx build --platform linux/arm64 -t "$REPO:$(git rev-parse HEAD)" --push .

pnpm --filter web build
aws s3 sync apps/web/dist "s3://<WEB_BUCKET>" --delete
aws cloudfront create-invalidation \
  --distribution-id "<CLOUDFRONT_DISTRIBUTION_ID>" --paths "/*"
```

Then dispatch the infrastructure apply yourself, or push to `main` and let
the workflow do it.

The store reviewers' environment is a second stack of the same root; see
`docs/DEPLOY-REVIEW.md`.
