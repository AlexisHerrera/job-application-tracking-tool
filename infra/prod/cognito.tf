# The login (plan §6): an Amazon Cognito user pool with one user, the owner. Sign-up is off,
# every sign-in needs the password and an authenticator-app code (TOTP), and the SPA signs in
# through Cognito's managed login pages (authorization code + PKCE, no client secret).
#
# The API accepts only ID tokens from this pool, for this app client, with the owner's verified
# email (backend/src/jobtracker/api/auth.py). Nothing here is secret: the pool and client IDs
# appear in the login page's URL anyway. Terraform never sees the password: Cognito emails a
# temporary one when it creates the user, and the first sign-in replaces it.

resource "aws_cognito_user_pool" "main" {
  name                = local.name
  user_pool_tier      = "ESSENTIALS" # free up to 10,000 monthly active users; managed login needs it
  deletion_protection = "ACTIVE"

  username_attributes      = ["email"]
  auto_verified_attributes = ["email"]
  username_configuration {
    case_sensitive = false
  }

  admin_create_user_config {
    allow_admin_create_user_only = true # no sign-up page
  }

  mfa_configuration = "ON"
  software_token_mfa_configuration {
    enabled = true # the authenticator app; set up at the first sign-in
  }

  password_policy {
    minimum_length                   = 12
    require_lowercase                = true
    require_uppercase                = true
    require_numbers                  = true
    require_symbols                  = false
    temporary_password_validity_days = 7
  }

  # "Forgot password" sends a code to the verified email. Cognito's own sender (no SES): its
  # daily cap is far above what one user needs.
  account_recovery_setting {
    recovery_mechanism {
      name     = "verified_email"
      priority = 1
    }
  }
  email_configuration {
    email_sending_account = "COGNITO_DEFAULT"
  }
}

# The login pages live on Cognito's own domain: https://<prefix>.auth.us-east-1.amazoncognito.com
resource "aws_cognito_user_pool_domain" "main" {
  domain                = var.login_domain_prefix
  user_pool_id          = aws_cognito_user_pool.main.id
  managed_login_version = 2 # managed login, not the classic hosted UI
}

resource "aws_cognito_user_pool_client" "web" {
  name         = "${local.name}-web"
  user_pool_id = aws_cognito_user_pool.main.id

  generate_secret                      = false # a browser app can't keep one; PKCE instead
  allowed_oauth_flows_user_pool_client = true
  allowed_oauth_flows                  = ["code"]
  allowed_oauth_scopes                 = ["openid", "email"]
  supported_identity_providers         = ["COGNITO"]
  callback_urls                        = ["https://${var.domain}/auth/callback"]
  logout_urls                          = ["https://${var.domain}/"]
  explicit_auth_flows                  = ["ALLOW_USER_AUTH", "ALLOW_USER_SRP_AUTH", "ALLOW_REFRESH_TOKEN_AUTH"]

  prevent_user_existence_errors = "ENABLED"
  enable_token_revocation       = true # signing out revokes the refresh token

  # The SPA renews the hour-long tokens quietly with the refresh token; after 7 days without a
  # sign-in, it asks for the password and code again.
  id_token_validity      = 60
  access_token_validity  = 60
  refresh_token_validity = 7
  token_validity_units {
    id_token      = "minutes"
    access_token  = "minutes"
    refresh_token = "days"
  }
}

# An app client created through the API has no managed login style until one exists, and its
# login pages don't load without it. Cognito's default look.
resource "aws_cognito_managed_login_branding" "web" {
  user_pool_id                = aws_cognito_user_pool.main.id
  client_id                   = aws_cognito_user_pool_client.web.id
  use_cognito_provided_values = true
}

# The only user. Creating it emails a temporary password to the owner (from
# no-reply@verificationemail.com; check spam). It expires after 7 days; to send a new one:
#   aws cognito-idp admin-create-user --user-pool-id <id> --username <email> --message-action RESEND
resource "aws_cognito_user" "owner" {
  user_pool_id             = aws_cognito_user_pool.main.id
  username                 = var.owner_email
  desired_delivery_mediums = ["EMAIL"]
  attributes = {
    email          = var.owner_email
    email_verified = "true"
  }
}

locals {
  login_domain = "https://${aws_cognito_user_pool_domain.main.domain}.auth.${local.region}.amazoncognito.com"
}
