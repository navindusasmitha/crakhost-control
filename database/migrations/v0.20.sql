-- CrakHost Control v0.48 transactional mail + account security

ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at timestamptz;
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_changed_at timestamptz;

-- Existing accounts pre-date mandatory email verification. Mark them verified once,
-- without auto-verifying accounts created after this feature ships. Migrations are
-- replayed on every deploy, so the marker makes this bootstrap idempotent.
CREATE TABLE IF NOT EXISTS feature_migration_markers (
  key varchar(120) PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM feature_migration_markers WHERE key='v0.48-email-verification-bootstrap') THEN
    UPDATE users SET email_verified_at=COALESCE(email_verified_at,now());
    INSERT INTO feature_migration_markers(key) VALUES('v0.48-email-verification-bootstrap') ON CONFLICT DO NOTHING;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS auth_challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose varchar(32) NOT NULL CHECK(purpose IN ('EMAIL_VERIFY','PASSWORD_RESET')),
  token_hash char(64) NOT NULL UNIQUE,
  otp_hash char(64) NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  attempts smallint NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 10),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_auth_challenges_user_purpose
  ON auth_challenges(user_id,purpose,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_auth_challenges_active
  ON auth_challenges(purpose,expires_at) WHERE consumed_at IS NULL;

ALTER TABLE mail_settings ADD COLUMN IF NOT EXISTS logo_url text NOT NULL DEFAULT 'https://i.ibb.co/pv5zb3Q5/logo-Photoroom.png';
UPDATE mail_settings
SET logo_url='https://i.ibb.co/pv5zb3Q5/logo-Photoroom.png'
WHERE trim(coalesce(logo_url,''))='';

INSERT INTO email_templates(key,name,description,subject,html_body,text_body,variables) VALUES
('email_verification','Email verification','Sent immediately after a new customer registers','Verify your CrakHost email',
$$<h1 style="margin:0 0 14px;color:#ffffff;font-size:26px">Verify your email</h1><p style="margin:0 0 16px">Hi {{name}}, welcome to CrakHost. Verify your email address to activate your account.</p><div style="margin:22px 0;padding:18px;border-radius:14px;background:#0b0d14;border:1px solid #2d3550;text-align:center"><div style="font-size:12px;color:#8f99ae;text-transform:uppercase;letter-spacing:1.4px">Verification code</div><div style="font-size:34px;line-height:1.4;letter-spacing:8px;font-weight:800;color:#ffffff">{{otp}}</div></div><p><a href="{{verify_url}}" style="display:inline-block;background:#7c5cff;color:#ffffff;text-decoration:none;padding:13px 20px;border-radius:10px;font-weight:700">Verify email</a></p><p style="color:#98a2b8;font-size:13px">This code and link expire in {{expires_minutes}} minutes. If you did not create this account, you can ignore this email.</p>$$,
$$Hi {{name}},

Verify your CrakHost email with this code: {{otp}}
Or open: {{verify_url}}

This verification expires in {{expires_minutes}} minutes.
If you did not create this account, ignore this email.
$$,
ARRAY['name','otp','verify_url','expires_minutes','panel_url','logo_url']),

('password_reset_otp','Password reset OTP','Sent when a customer requests a password reset','Your CrakHost password reset code',
$$<h1 style="margin:0 0 14px;color:#ffffff;font-size:26px">Reset your password</h1><p style="margin:0 0 16px">Hi {{name}}, use the one-time code below or the secure button to reset your CrakHost password.</p><div style="margin:22px 0;padding:18px;border-radius:14px;background:#0b0d14;border:1px solid #2d3550;text-align:center"><div style="font-size:12px;color:#8f99ae;text-transform:uppercase;letter-spacing:1.4px">One-time code</div><div style="font-size:34px;line-height:1.4;letter-spacing:8px;font-weight:800;color:#ffffff">{{otp}}</div></div><p><a href="{{reset_url}}" style="display:inline-block;background:#7c5cff;color:#ffffff;text-decoration:none;padding:13px 20px;border-radius:10px;font-weight:700">Reset password</a></p><p style="color:#98a2b8;font-size:13px">Expires in {{expires_minutes}} minutes. If you did not request this, do not share the code and ignore this email.</p>$$,
$$Hi {{name}},

Your CrakHost password reset code is: {{otp}}
Reset link: {{reset_url}}
Expires in {{expires_minutes}} minutes.

If you did not request this, ignore this email.
$$,
ARRAY['name','otp','reset_url','expires_minutes','panel_url','logo_url']),

('password_changed','Password changed','Security confirmation after a password reset','Your CrakHost password was changed',
$$<h1 style="margin:0 0 14px;color:#ffffff;font-size:26px">Password changed</h1><p>Hi {{name}}, the password for your CrakHost account was changed successfully.</p><p style="color:#98a2b8">All previous control-panel sessions were signed out. If you did not make this change, contact support immediately.</p><p><a href="{{support_url}}" style="display:inline-block;background:#7c5cff;color:#ffffff;text-decoration:none;padding:13px 20px;border-radius:10px;font-weight:700">Contact support</a></p>$$,
$$Hi {{name}},

Your CrakHost password was changed successfully and previous sessions were signed out.
If this was not you, contact support: {{support_url}}
$$,
ARRAY['name','support_url','panel_url','logo_url']),

('invoice_due','Invoice due','Sent when an unpaid invoice is created','Invoice {{invoice_number}} is awaiting payment',
$$<h1 style="margin:0 0 14px;color:#ffffff;font-size:26px">Invoice awaiting payment</h1><p>Hi {{name}}, invoice <strong>{{invoice_number}}</strong> has been created for {{description}}.</p><div style="margin:20px 0;padding:18px;border-radius:14px;background:#0b0d14;border:1px solid #2d3550"><div style="font-size:12px;color:#8f99ae">AMOUNT DUE</div><div style="font-size:28px;font-weight:800;color:#ffffff">{{currency}} {{amount}}</div><div style="margin-top:8px;color:#98a2b8">Due: {{due_date}}</div></div><p><a href="{{billing_url}}" style="display:inline-block;background:#7c5cff;color:#ffffff;text-decoration:none;padding:13px 20px;border-radius:10px;font-weight:700">Open billing</a></p>$$,
$$Hi {{name}},

Invoice {{invoice_number}} is awaiting payment.
{{description}}
Amount: {{currency}} {{amount}}
Due: {{due_date}}
Billing: {{billing_url}}
$$,
ARRAY['name','invoice_number','description','currency','amount','due_date','billing_url','logo_url']),

('payment_refunded','Payment refunded','Sent when an order payment is returned automatically','Refund issued for {{server_name}}',
$$<h1 style="margin:0 0 14px;color:#ffffff;font-size:26px">Payment refunded</h1><p>Hi {{name}}, we could not complete provisioning for <strong>{{server_name}}</strong>, so your payment was returned automatically.</p><div style="margin:20px 0;padding:18px;border-radius:14px;background:#0b0d14;border:1px solid #2d3550"><div style="font-size:12px;color:#8f99ae">REFUNDED</div><div style="font-size:28px;font-weight:800;color:#ffffff">{{currency}} {{amount}}</div></div><p style="color:#98a2b8">Reason: {{reason}}</p><p><a href="{{billing_url}}" style="display:inline-block;background:#7c5cff;color:#ffffff;text-decoration:none;padding:13px 20px;border-radius:10px;font-weight:700">View billing</a></p>$$,
$$Hi {{name}},

Your payment for {{server_name}} was refunded.
Amount: {{currency}} {{amount}}
Reason: {{reason}}
Billing: {{billing_url}}
$$,
ARRAY['name','server_name','currency','amount','reason','billing_url','logo_url'])
ON CONFLICT(key) DO NOTHING;
