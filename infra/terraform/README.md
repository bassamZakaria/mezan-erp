# `infra/terraform`

Two roots. `bootstrap/` is applied once by hand and creates the S3 bucket and
DynamoDB table that hold the state of everything else. The root beside it
creates the cloud edition: the web bundle on S3 behind CloudFront, one Fargate
task on an EFS data directory with a backup sidecar, an HTTP API in front of
it, and the Route 53 zone that serves the domain and every tenant subdomain.

Region is `eu-central-1`. The CloudFront certificate is issued in `us-east-1`
through the `aws.us_east_1` provider alias, because CloudFront reads viewer
certificates only from that region.

## One-time bootstrap

```sh
cd infra/terraform/bootstrap
terraform init
terraform apply -var 'state_bucket=mezan-tfstate-<something-unique>'
```

Keep the three outputs — `state_bucket`, `lock_table`, `region`.

## Initialising the main root

```sh
cd infra/terraform
terraform init \
  -backend-config="bucket=mezan-tfstate-<something-unique>" \
  -backend-config="key=mezan/demo.tfstate" \
  -backend-config="region=eu-central-1" \
  -backend-config="dynamodb_table=mezan-tfstate-lock"
```

## Secrets

`platform_owner_password` has no default and is never written to a tfvars file:

```sh
export TF_VAR_platform_owner_password='…'
```

It seeds the platform owner on the first start of the server and is then
ignored on every later apply, so changing the password in the console sticks.

## Applying

```sh
terraform plan  -var-file=envs/demo.tfvars -var 'image_tag=<sha>'
terraform apply -var-file=envs/demo.tfvars -var 'image_tag=<sha>'
```

`envs/demo.tfvars` ships with `domain = "example.invalid"`. Replace it with the
domain you actually own before the first apply — the ACM certificate cannot be
validated otherwise and the apply will sit waiting.

## Nameservers

The first apply creates the hosted zone. Enter

```sh
terraform output hosted_zone_name_servers
```

at the registrar for the domain. Until the delegation is live, ACM cannot
validate the certificate and CloudFront cannot finish.

## Deploy loop

`.github/workflows/deploy-aws.yml` runs it on every push to `main`: build and
push the ARM64 image to ECR under the commit SHA, `terraform apply` with that
tag, sync `apps/web/dist` into the web bucket, invalidate the distribution.

## Cost

| Item | Monthly |
|---|---|
| Fargate, 0.25 vCPU / 0.5 GB, always on | ≈ 9 USD |
| API Gateway HTTP API | < 1 USD |
| Route 53 hosted zone | 0.50 USD |
| EFS, S3, ECR, CloudWatch logs | cents |
| CloudFront, ACM | free tier |
| **Total** | **≈ 11–13 USD** |
