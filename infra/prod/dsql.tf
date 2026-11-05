# Aurora DSQL, single Region. No VPC: the Lambdas reach its public endpoint with IAM auth.
# Always Free covers 100k DPU + 1 GB a month; the budget alert catches surprises.
resource "aws_dsql_cluster" "main" {
  deletion_protection_enabled = true
  tags = {
    Name = local.name
  }
}
