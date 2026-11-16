output "dsql_endpoint" {
  value = local.dsql_endpoint
}

output "cloudfront_domain" {
  value = aws_cloudfront_distribution.main.domain_name
}

output "cloudfront_distribution_id" {
  value = aws_cloudfront_distribution.main.id
}

output "web_bucket" {
  value = aws_s3_bucket.web.bucket
}

output "api_function_url" {
  description = "Direct calls get 403 (AWS_IAM); only CloudFront can call it."
  value       = aws_lambda_function_url.api.function_url
}

output "ingest_function_name" {
  value = module.ingest.function_name
}

output "discover_function_name" {
  value = module.discover.function_name
}

output "app_url" {
  value = "https://${var.domain}"
}

output "login_domain" {
  value = local.login_domain
}

output "user_pool_id" {
  value = aws_cognito_user_pool.main.id
}

output "next_steps" {
  description = "Run from backend/ after apply (they touch AWS and, for the copy, write DSQL)."
  value       = <<-EOT
    uv run jobtracker db migrate --dsql ${local.dsql_endpoint}
    uv run jobtracker db grant-roles --dsql ${local.dsql_endpoint} \
      --role jobtracker_api=${module.api.role_arn} \
      --role jobtracker_ingest=${module.ingest.role_arn} \
      --role jobtracker_discover=${module.discover.role_arn}
    uv run jobtracker aws push-secrets
    uv run jobtracker db copy-to-dsql --dsql ${local.dsql_endpoint} --dry-run
  EOT
}
