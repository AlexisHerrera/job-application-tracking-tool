# jobs.alexisherrera.dev in the existing Route 53 zone. The zone itself belongs to whoever made
# it (another project's Terraform also adds records there): this stack only reads it and owns
# the records below, never the zone or anyone else's records.

data "aws_route53_zone" "main" {
  name         = var.dns_zone
  private_zone = false
}

# ACM's validation CNAME. Kept after validation: ACM renews the certificate through it.
resource "aws_route53_record" "cert_validation" {
  for_each = {
    for o in aws_acm_certificate.site.domain_validation_options : o.domain_name => o
  }
  zone_id = data.aws_route53_zone.main.zone_id
  name    = each.value.resource_record_name
  type    = each.value.resource_record_type
  records = [each.value.resource_record_value]
  ttl     = 300
}

# Waits until ACM says ISSUED (usually a few minutes), so CloudFront below gets a usable cert.
resource "aws_acm_certificate_validation" "site" {
  certificate_arn         = aws_acm_certificate.site.arn
  validation_record_fqdns = [for r in aws_route53_record.cert_validation : r.fqdn]
}

resource "aws_route53_record" "site" {
  for_each = toset(["A", "AAAA"])
  zone_id  = data.aws_route53_zone.main.zone_id
  name     = var.domain
  type     = each.key
  alias {
    name                   = aws_cloudfront_distribution.main.domain_name
    zone_id                = aws_cloudfront_distribution.main.hosted_zone_id
    evaluate_target_health = false
  }
}
