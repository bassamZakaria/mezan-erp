resource "aws_ssm_parameter" "platform_owner_email" {
  name  = "/mezan/${var.environment}/platform-owner-email"
  type  = "SecureString"
  value = var.platform_owner_email
}

resource "aws_ssm_parameter" "platform_owner_password" {
  name  = "/mezan/${var.environment}/platform-owner-password"
  type  = "SecureString"
  value = var.platform_owner_password

  # The owner changes this password in the console after the first login.
  # Without this, every apply would push the initial value back over it.
  lifecycle {
    ignore_changes = [value]
  }
}

# Shared between the app container (env.ts reads MEZAN_ORIGIN_SECRET) and
# CloudFront's custom origin header on the API origin (cdn.tf), so a direct
# hit on the API Gateway endpoint — bypassing CloudFront entirely — 403s.
resource "random_password" "origin_secret" {
  length  = 40
  special = false
}

resource "aws_ssm_parameter" "origin_secret" {
  name  = "/mezan/${var.environment}/origin-secret"
  type  = "SecureString"
  value = random_password.origin_secret.result
}
