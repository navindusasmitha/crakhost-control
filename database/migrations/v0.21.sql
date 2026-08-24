-- CrakHost Control v0.49 website + business administration
ALTER TABLE users ADD COLUMN IF NOT EXISTS banned_at timestamptz;
ALTER TABLE users ADD COLUMN IF NOT EXISTS ban_reason text NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS idx_users_banned_at ON users(banned_at) WHERE banned_at IS NOT NULL;

INSERT INTO email_templates(key,name,description,subject,html_body,text_body,variables) VALUES
('ticket_created','Support ticket created','Confirmation sent when a customer opens a ticket','Support ticket opened: {{ticket_subject}}',
$$<h1 style="margin:0 0 14px;color:#ffffff;font-size:26px">Ticket received</h1><p>Hi {{name}}, your CrakHost support ticket <strong>{{ticket_subject}}</strong> has been opened successfully.</p><p style="color:#98a2b8">Ticket ID: {{ticket_id}}</p><p><a href="{{support_url}}" style="display:inline-block;background:#6366f1;color:#ffffff;text-decoration:none;padding:13px 20px;border-radius:10px;font-weight:700">Open support ticket</a></p><p style="color:#98a2b8;font-size:13px">Staff replies will appear in your support workspace and may also be delivered by email.</p>$$,
$$Hi {{name}},

Your CrakHost support ticket "{{ticket_subject}}" has been opened.
Ticket ID: {{ticket_id}}
Support: {{support_url}}
$$,
ARRAY['name','ticket_subject','ticket_id','support_url','logo_url'])
ON CONFLICT(key) DO NOTHING;
