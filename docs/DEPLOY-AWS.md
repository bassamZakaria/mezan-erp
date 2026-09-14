# Deploying the cloud edition on AWS

The cloud edition is one Fargate task serving every tenant, an EFS directory
holding one SQLite file per tenant, and a CloudFront distribution serving the
web bundle and proxying `/api/*` to an HTTP API. About 11 to 13 USD a month.
Everything is described in `infra/terraform`; nothing is created by hand.

## Prerequisites

- An AWS account, and credentials with rights to create the resources below.
- A domain you own, whose nameservers you can change at the registrar.
- Terraform 1.9 or later, the AWS CLI, Docker with buildx, Node 22 and pnpm.

## 1. One-time bootstrap

State lives in S3 with a DynamoDB lock table. The root that creates them keeps
its own state on your machine, and is applied once:

```sh
cd infra/terraform/bootstrap
terraform init
terraform apply -var 'state_bucket=mezan-tfstate-<something-unique>'
terraform output
```

Commit nothing from this directory: `terraform.tfstate` is git-ignored and
belongs in your password manager or a private backup.

## 2. First apply

Point `envs/demo.tfvars` at the domain you own, then:

```sh
cd infra/terraform
terraform init \
  -backend-config="bucket=mezan-tfstate-<something-unique>" \
  -backend-config="key=mezan/demo.tfstate" \
  -backend-config="region=eu-central-1" \
  -backend-config="dynamodb_table=mezan-tfstate-lock"

export TF_VAR_platform_owner_password='<a long password you keep>'
terraform apply -var-file=envs/demo.tfvars
```

The first apply stops at the ACM certificate, which cannot validate until the
domain is delegated. That is the next step; re-run `terraform apply` after it.

## 3. Nameservers

```sh
terraform output hosted_zone_name_servers
```

Enter those four at the registrar for the domain. Delegation usually takes
minutes and can take a day. When `dig NS <domain>` answers with them, re-run
`terraform apply`; the certificate validates and the distribution finishes.

## 4. First login

The platform owner is seeded from the two SSM parameters on the server's first
start: `/mezan/<env>/platform-owner-email` and
`/mezan/<env>/platform-owner-password`. Open `https://<domain>/platform`, sign
in with them, and change the password. Terraform ignores later changes to the
parameter value, so the change is not undone by the next apply.

Tenants are created from that console. A tenant with code `cyag` is reachable
at `https://cyag.<domain>` with no company code to type, because the wildcard
record and the wildcard certificate both cover it.

## 5. Redeploying

`.github/workflows/deploy-aws.yml` does it on every push to `main`. It needs
four repository secrets:

| Secret | What it is |
|---|---|
| `AWS_DEPLOY_ROLE_ARN` | Role the workflow assumes through GitHub OIDC |
| `AWS_TF_STATE_BUCKET` | The bootstrap state bucket |
| `AWS_TF_LOCK_TABLE` | The bootstrap lock table |
| `MEZAN_PLATFORM_OWNER_PASSWORD` | Only read on the very first apply |

The same thing by hand:

```sh
REPO=$(terraform output -raw ecr_repository_url)
aws ecr get-login-password --region eu-central-1 \
  | docker login --username AWS --password-stdin "${REPO%%/*}"
docker buildx build --platform linux/arm64 -t "$REPO:$(git rev-parse HEAD)" --push .
terraform apply -var-file=envs/demo.tfvars -var "image_tag=$(git rev-parse HEAD)"

pnpm --filter web build
aws s3 sync apps/web/dist "s3://$(terraform output -raw web_bucket)" --delete
aws cloudfront create-invalidation \
  --distribution-id "$(terraform output -raw cloudfront_distribution_id)" --paths "/*"
```

A deploy is a gap, not an overlap: the service runs at minimum 0 percent and
maximum 100 percent healthy, so the old task stops before the new one starts.
Every tenant database is a single SQLite file opened in exclusive locking mode,
and a second task would be a second writer.

## 6. Backups

The app writes its own verified archives into `/data/backups`. A sidecar in the
same task syncs that directory to the backup bucket every 15 minutes
(`backup_interval_minutes`). The bucket is versioned and expires noncurrent
versions after 30 days.

```sh
aws s3 ls "s3://$(terraform output -raw backup_bucket)/backups/"
aws s3 cp "s3://$(terraform output -raw backup_bucket)/backups/<archive>" .
```

To restore, put the archive back where the app can see it and restore it
through the app's own restore path, which checks the archive before it replaces
anything. Copying a `.db` file over a live one is not a restore: the task holds
an exclusive lock and a WAL beside it.

## 7. Tearing down

```sh
terraform destroy -var-file=envs/demo.tfvars
```

Take a backup copy first — this deletes the EFS filesystem and every tenant
database on it. The S3 buckets must be emptied before they will delete. Then
`terraform destroy` in `bootstrap/`, and remove the delegation at the
registrar.
