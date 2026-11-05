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

variable "monthly_budget_usd" {
  type    = number
  default = 5
}

variable "log_retention_days" {
  type    = number
  default = 14
}
