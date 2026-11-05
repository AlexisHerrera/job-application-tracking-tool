variable "aws_profile" {
  type    = string
  default = "jobtracker"
}

variable "lambda_zip" {
  type        = string
  default     = "../build/lambda.zip"
  description = "Built by ../scripts/build-lambda.sh"
}

variable "owner_email" {
  type        = string
  default     = "alexysaguilar@gmail.com"
  description = "Inbox, calendar ID, the only user the API lets in, and where budget alerts go."
}

variable "domain" {
  type    = string
  default = "jobs.alexisherrera.dev"
}

variable "cf_access_team_domain" {
  type    = string
  default = "alexisherrera.cloudflareaccess.com"
}

variable "cf_access_aud" {
  type        = string
  default     = "not-configured-until-phase-4"
  description = "Cloudflare Access application AUD tag. Until Phase 4 no token can match, so the API answers 401 to everything."
}

variable "ingest_schedule_enabled" {
  type        = bool
  default     = true # turned on 2026-11-04, after the data copy and a first manual run
  description = "Every run reads the real inbox and can make paid LLM calls. Set false to pause ingest."
}

variable "monthly_budget_usd" {
  type    = number
  default = 5
}

variable "log_retention_days" {
  type    = number
  default = 14
}
