output "cloudfront_domain" {
  description = "Domain name of the CloudFront distribution; the target of the apex and wildcard alias records."
  value       = aws_cloudfront_distribution.main.domain_name
}

output "hosted_zone_name_servers" {
  description = "Nameservers to enter at the registrar for the domain."
  value       = aws_route53_zone.main.name_servers
}

output "ecr_repository_url" {
  description = "Repository the deploy workflow pushes the application image to."
  value       = aws_ecr_repository.app.repository_url
}

output "web_bucket" {
  description = "Bucket the built web client is synced into."
  value       = aws_s3_bucket.web.id
}

output "backup_bucket" {
  description = "Bucket the sidecar syncs /data/backups into."
  value       = aws_s3_bucket.backup.id
}

output "cluster_name" {
  description = "ECS cluster running the application task."
  value       = aws_ecs_cluster.main.name
}

output "service_name" {
  description = "ECS service running the application task."
  value       = aws_ecs_service.app.name
}

output "api_endpoint" {
  description = "Endpoint of the HTTP API behind the CloudFront /api/* behaviour."
  value       = aws_apigatewayv2_api.main.api_endpoint
}

output "cloudfront_distribution_id" {
  description = "Distribution the deploy workflow invalidates after a web sync."
  value       = aws_cloudfront_distribution.main.id
}
