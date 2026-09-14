output "state_bucket" {
  description = "Bucket name to pass to the main root as -backend-config=bucket=..."
  value       = aws_s3_bucket.state.id
}

output "lock_table" {
  description = "Table name to pass to the main root as -backend-config=dynamodb_table=..."
  value       = aws_dynamodb_table.lock.name
}

output "region" {
  description = "Region to pass to the main root as -backend-config=region=..."
  value       = var.region
}
