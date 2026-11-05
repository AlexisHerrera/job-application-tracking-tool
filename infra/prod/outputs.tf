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

output "acm_validation_records" {
  description = "CNAMEs for Phase 4 (Cloudflare DNS, DNS only / not proxied)."
  value = [for o in aws_acm_certificate.site.domain_validation_options : {
    name  = o.resource_record_name
    type  = o.resource_record_type
    value = o.resource_record_value
  }]
}

output "next_steps" {
  description = "Run from backend/ after apply (they touch AWS and, for the copy, write DSQL)."
  value       = <<-EOT
    uv run jobtracker db migrate --dsql ${local.dsql_endpoint}
    uv run jobtracker db grant-roles --dsql ${local.dsql_endpoint} \
      --role jobtracker_api=${module.api.role_arn} \
      --role jobtracker_ingest=${module.ingest.role_arn}
    uv run jobtracker aws push-secrets
    uv run jobtracker db copy-to-dsql --dsql ${local.dsql_endpoint} --dry-run
  EOT
}
