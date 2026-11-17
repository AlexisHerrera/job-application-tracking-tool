variable "aws_profile" {
  type    = string
  default = "jobtracker"
}

variable "lambda_zip" {
  type        = string
  default     = "../build/lambda.zip"
  description = "Built by ../scripts/build-lambda.sh. Only used to create a function; CI deploys code after that."
}

variable "aws_account_id" {
  type        = string
  description = "The only account this stack may touch (provider allowed_account_ids). Set in terraform.tfvars."
}

variable "owner_email" {
  type        = string
  description = "Inbox, calendar ID, the only user the API lets in, and where budget alerts go. Set in terraform.tfvars."
}

variable "domain" {
  type    = string
  default = "jobs.alexisherrera.dev"
}

variable "dns_zone" {
  type        = string
  default     = "alexisherrera.dev"
  description = "Existing Route 53 public zone. This stack only adds its own records to it."
}

variable "login_domain_prefix" {
  type        = string
  default     = "alexisherrera-jobs"
  description = "Cognito login pages at https://<prefix>.auth.us-east-1.amazoncognito.com (unique per region)."
}

variable "ingest_schedule_enabled" {
  type        = bool
  default     = true # turned on 2026-11-04, after the data copy and a first manual run
  description = "Every run reads the real inbox and can make paid LLM calls. Set false to pause ingest."
}

variable "discover_schedule_enabled" {
  type        = bool
  default     = true
  description = "Discovery every 6 hours (paid LLM calls for new postings) and the 09:00 digest. Set false to pause both."
}

variable "monthly_budget_usd" {
  type    = number
  default = 5
}

variable "log_retention_days" {
  type    = number
  default = 14
}

variable "github_repo" {
  type        = string
  default     = "AlexisHerrera/job-application-tracking-tool"
  description = "owner/name of the repository whose main branch may deploy."
}

variable "github_oidc_subject" {
  type    = string
  default = "repo:AlexisHerrera@52416190/job-application-tracking-tool@1425957208"
  # GitHub's immutable subject format: owner and repository with their numeric IDs, so a renamed
  # or re-created repo with the same name can't deploy. `sub_claim_prefix` in
  #   gh api repos/<owner>/<repo>/actions/oidc/customization/sub
  description = "Start of the `sub` claim in the repository's OIDC tokens (before `:ref:...`)."
}
