-- CrakHost Control v0.46 SMTP mail center
CREATE TABLE IF NOT EXISTS mail_settings (
  id smallint PRIMARY KEY DEFAULT 1 CHECK(id=1),
  enabled boolean NOT NULL DEFAULT false,
  host varchar(255) NOT NULL DEFAULT '',
  port integer NOT NULL DEFAULT 587 CHECK(port BETWEEN 1 AND 65535),
  encryption varchar(16) NOT NULL DEFAULT 'STARTTLS' CHECK(encryption IN ('STARTTLS','SSL_TLS','NONE')),
  username varchar(255) NOT NULL DEFAULT '',
  password_cipher text NOT NULL DEFAULT '',
  from_name varchar(160) NOT NULL DEFAULT 'CrakHost',
  from_email varchar(255) NOT NULL DEFAULT '',
  reply_to varchar(255) NOT NULL DEFAULT '',
  reject_unauthorized boolean NOT NULL DEFAULT true,
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO mail_settings(id) VALUES(1) ON CONFLICT(id) DO NOTHING;

CREATE TABLE IF NOT EXISTS email_templates (
  key varchar(80) PRIMARY KEY,
  name varchar(140) NOT NULL,
  description varchar(255) NOT NULL DEFAULT '',
  subject text NOT NULL,
  html_body text NOT NULL,
  text_body text NOT NULL DEFAULT '',
  variables text[] NOT NULL DEFAULT ARRAY[]::text[],
  enabled boolean NOT NULL DEFAULT true,
  system_template boolean NOT NULL DEFAULT true,
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS email_delivery_logs (
  id bigserial PRIMARY KEY,
  template_key varchar(80),
  recipient varchar(255) NOT NULL,
  subject text NOT NULL DEFAULT '',
  status varchar(20) NOT NULL CHECK(status IN ('SENT','FAILED','SKIPPED')),
  message_id varchar(255) NOT NULL DEFAULT '',
  error text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_email_delivery_logs_created ON email_delivery_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_delivery_logs_status ON email_delivery_logs(status,created_at DESC);

INSERT INTO email_templates(key,name,description,subject,html_body,text_body,variables) VALUES
('welcome','Welcome email','Sent after a customer account is created','Welcome to CrakHost, {{name}}',
$$<div style="font-family:Arial,sans-serif;background:#0b0d14;color:#e9ecf4;padding:32px"><div style="max-width:620px;margin:auto;background:#121622;border:1px solid #252c40;border-radius:18px;padding:28px"><h1 style="margin:0 0 12px;color:#fff">Welcome to CrakHost</h1><p>Hi {{name}}, your CrakHost account is ready.</p><p>You can manage hosting services, billing, backups and support from the control panel.</p><p><a href="{{panel_url}}" style="display:inline-block;background:#7c5cff;color:#fff;text-decoration:none;padding:12px 18px;border-radius:10px;font-weight:bold">Open CrakHost Control</a></p><p style="color:#7f899f;font-size:12px">CrakHost · Powered by CrakNode</p></div></div>$$,
$$Hi {{name}},

Your CrakHost account is ready.
Open the control panel: {{panel_url}}

CrakHost$$,
ARRAY['name','panel_url']),
('server_ready','Server ready','Sent after a server is successfully provisioned','{{server_name}} is ready',
$$<div style="font-family:Arial,sans-serif;background:#0b0d14;color:#e9ecf4;padding:32px"><div style="max-width:620px;margin:auto;background:#121622;border:1px solid #252c40;border-radius:18px;padding:28px"><h1 style="margin:0 0 12px;color:#fff">Server ready</h1><p>Hi {{name}}, <strong>{{server_name}}</strong> has been provisioned successfully.</p><p>Node: {{node_name}}</p><p><a href="{{server_url}}" style="display:inline-block;background:#7c5cff;color:#fff;text-decoration:none;padding:12px 18px;border-radius:10px;font-weight:bold">Open Server</a></p></div></div>$$,
$$Hi {{name}},

{{server_name}} is ready on {{node_name}}.
Open it here: {{server_url}}
$$,
ARRAY['name','server_name','node_name','server_url']),
('invoice_paid','Invoice paid','Payment confirmation template','Payment received · {{invoice_number}}',
$$<div style="font-family:Arial,sans-serif;background:#0b0d14;color:#e9ecf4;padding:32px"><div style="max-width:620px;margin:auto;background:#121622;border:1px solid #252c40;border-radius:18px;padding:28px"><h1 style="margin:0 0 12px;color:#fff">Payment received</h1><p>Hi {{name}}, invoice <strong>{{invoice_number}}</strong> has been marked paid.</p><p style="font-size:22px;font-weight:bold">{{currency}} {{amount}}</p><p><a href="{{billing_url}}" style="display:inline-block;background:#7c5cff;color:#fff;text-decoration:none;padding:12px 18px;border-radius:10px;font-weight:bold">View Billing</a></p></div></div>$$,
$$Hi {{name}},

Payment received for invoice {{invoice_number}}.
Amount: {{currency}} {{amount}}
Billing: {{billing_url}}
$$,
ARRAY['name','invoice_number','currency','amount','billing_url']),
('support_reply','Support reply','Sent when staff replies to a support ticket','Support replied · {{ticket_subject}}',
$$<div style="font-family:Arial,sans-serif;background:#0b0d14;color:#e9ecf4;padding:32px"><div style="max-width:620px;margin:auto;background:#121622;border:1px solid #252c40;border-radius:18px;padding:28px"><h1 style="margin:0 0 12px;color:#fff">New support reply</h1><p>Hi {{name}}, CrakHost Support replied to <strong>{{ticket_subject}}</strong>.</p><div style="background:#0c0f19;border-radius:12px;padding:16px;margin:18px 0;white-space:pre-wrap">{{message}}</div><p><a href="{{support_url}}" style="display:inline-block;background:#7c5cff;color:#fff;text-decoration:none;padding:12px 18px;border-radius:10px;font-weight:bold">Open Ticket</a></p></div></div>$$,
$$Hi {{name}},

CrakHost Support replied to {{ticket_subject}}:

{{message}}

Open support: {{support_url}}
$$,
ARRAY['name','ticket_subject','message','support_url']),
('server_suspended','Server suspended','Service suspension notice','{{server_name}} has been suspended',
$$<div style="font-family:Arial,sans-serif;background:#0b0d14;color:#e9ecf4;padding:32px"><div style="max-width:620px;margin:auto;background:#121622;border:1px solid #252c40;border-radius:18px;padding:28px"><h1 style="margin:0 0 12px;color:#fff">Server suspended</h1><p>Hi {{name}}, <strong>{{server_name}}</strong> has been suspended.</p><p>Reason: {{reason}}</p><p><a href="{{support_url}}" style="display:inline-block;background:#7c5cff;color:#fff;text-decoration:none;padding:12px 18px;border-radius:10px;font-weight:bold">Contact Support</a></p></div></div>$$,
$$Hi {{name}},

{{server_name}} has been suspended.
Reason: {{reason}}
Support: {{support_url}}
$$,
ARRAY['name','server_name','reason','support_url']),
('password_reset','Password reset','Ready for a future password-reset workflow','Reset your CrakHost password',
$$<div style="font-family:Arial,sans-serif;background:#0b0d14;color:#e9ecf4;padding:32px"><div style="max-width:620px;margin:auto;background:#121622;border:1px solid #252c40;border-radius:18px;padding:28px"><h1 style="margin:0 0 12px;color:#fff">Reset your password</h1><p>Hi {{name}}, use the button below to reset your CrakHost password.</p><p><a href="{{reset_url}}" style="display:inline-block;background:#7c5cff;color:#fff;text-decoration:none;padding:12px 18px;border-radius:10px;font-weight:bold">Reset Password</a></p><p>This link expires in {{expires_minutes}} minutes.</p></div></div>$$,
$$Hi {{name}},

Reset your password: {{reset_url}}
This link expires in {{expires_minutes}} minutes.
$$,
ARRAY['name','reset_url','expires_minutes'])
ON CONFLICT(key) DO NOTHING;
