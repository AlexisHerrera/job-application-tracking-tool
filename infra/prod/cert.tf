# The certificate for jobs.alexisherrera.dev (CloudFront requires us-east-1). It stays
# PENDING_VALIDATION until Phase 4 adds the validation CNAMEs in Cloudflare; nothing waits on it.
resource "aws_acm_certificate" "site" {
  domain_name       = var.domain
  validation_method = "DNS"
  lifecycle {
    create_before_destroy = true
  }
}
