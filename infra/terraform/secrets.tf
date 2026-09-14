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
