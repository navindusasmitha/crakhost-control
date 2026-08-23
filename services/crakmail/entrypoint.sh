#!/usr/bin/env bash
set -Eeuo pipefail

: "${MAIL_DOMAIN:?MAIL_DOMAIN is required}"
: "${MAIL_HOSTNAME:?MAIL_HOSTNAME is required}"
: "${POSTGRES_PASSWORD:?POSTGRES_PASSWORD is required}"

DB_HOST="${CRAKMAIL_DB_HOST:-postgres}"
DB_PORT="${CRAKMAIL_DB_PORT:-5432}"
DB_NAME="${CRAKMAIL_DB_NAME:-crakhost}"
DB_USER="${CRAKMAIL_DB_USER:-crakhost}"
DKIM_SELECTOR="${CRAKMAIL_DKIM_SELECTOR:-mail}"
TLS_CERT="${CRAKMAIL_TLS_CERT:-/etc/letsencrypt/live/${MAIL_HOSTNAME}/fullchain.pem}"
TLS_KEY="${CRAKMAIL_TLS_KEY:-/etc/letsencrypt/live/${MAIL_HOSTNAME}/privkey.pem}"

if [[ ! "$MAIL_DOMAIN" =~ ^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$ ]]; then
  echo "CrakMail: invalid MAIL_DOMAIN: $MAIL_DOMAIN" >&2
  exit 1
fi
if [[ ! "$MAIL_HOSTNAME" =~ ^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$ ]]; then
  echo "CrakMail: invalid MAIL_HOSTNAME: $MAIL_HOSTNAME" >&2
  exit 1
fi
if [[ ! -r "$TLS_CERT" || ! -r "$TLS_KEY" ]]; then
  echo "CrakMail: TLS certificate is missing. Expected:" >&2
  echo "  $TLS_CERT" >&2
  echo "  $TLS_KEY" >&2
  echo "Issue the Let's Encrypt certificate for $MAIL_HOSTNAME before starting CrakMail." >&2
  exit 1
fi

mkdir -p /var/mail/vhosts /var/lib/crakmail/dkim /etc/opendkim /run/dovecot /var/spool/postfix/private
chown -R crakmail:crakmail /var/mail/vhosts
chmod 0750 /var/mail/vhosts

export PGPASSWORD="$POSTGRES_PASSWORD"
echo "CrakMail: waiting for PostgreSQL at ${DB_HOST}:${DB_PORT}..."
for i in $(seq 1 60); do
  if pg_isready -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" >/dev/null 2>&1; then break; fi
  if [[ "$i" = 60 ]]; then echo "CrakMail: PostgreSQL did not become ready" >&2; exit 1; fi
  sleep 2
done

# Bootstrap the first domain from the deployment environment. Later domain changes are managed in the web UI.
psql -v ON_ERROR_STOP=1 -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" \
  -v domain="$MAIL_DOMAIN" -v hostname="$MAIL_HOSTNAME" -v selector="$DKIM_SELECTOR" <<'SQL'
INSERT INTO mail_domains(domain,hostname,dkim_selector,enabled,is_primary)
VALUES (lower(:'domain'),lower(:'hostname'),lower(:'selector'),true,
  NOT EXISTS (SELECT 1 FROM mail_domains WHERE is_primary=true))
ON CONFLICT(domain) DO UPDATE SET
  hostname=excluded.hostname,
  enabled=true,
  updated_at=now();
SQL

cat >/etc/postfix/pgsql-virtual-mailbox-domains.cf <<EOF
hosts = ${DB_HOST}:${DB_PORT}
user = ${DB_USER}
password = ${POSTGRES_PASSWORD}
dbname = ${DB_NAME}
query = SELECT 1 FROM mail_domains WHERE domain=lower('%s') AND enabled=true
EOF
cat >/etc/postfix/pgsql-virtual-mailbox-maps.cf <<EOF
hosts = ${DB_HOST}:${DB_PORT}
user = ${DB_USER}
password = ${POSTGRES_PASSWORD}
dbname = ${DB_NAME}
query = SELECT 1 FROM mailboxes m JOIN mail_domains d ON d.id=m.domain_id WHERE m.email=lower('%s') AND m.enabled=true AND d.enabled=true
EOF
cat >/etc/postfix/pgsql-virtual-alias-maps.cf <<EOF
hosts = ${DB_HOST}:${DB_PORT}
user = ${DB_USER}
password = ${POSTGRES_PASSWORD}
dbname = ${DB_NAME}
query = SELECT destination FROM mail_aliases a JOIN mail_domains d ON d.id=a.domain_id WHERE a.source=lower('%s') AND a.enabled=true AND d.enabled=true
EOF
chmod 0600 /etc/postfix/pgsql-virtual-*.cf

cat >/etc/dovecot/dovecot-sql.conf.ext <<EOF
driver = pgsql
connect = host=${DB_HOST} port=${DB_PORT} dbname=${DB_NAME} user=${DB_USER} password=${POSTGRES_PASSWORD}
default_pass_scheme = SSHA512
password_query = SELECT m.password_hash AS password FROM mailboxes m JOIN mail_domains d ON d.id=m.domain_id WHERE m.email=lower('%u') AND m.enabled=true AND d.enabled=true
user_query = SELECT 5000 AS uid, 5000 AS gid, '/var/mail/vhosts/' || d.domain || '/' || m.local_part AS home, '*:storage=' || m.quota_mb || 'M' AS quota_rule FROM mailboxes m JOIN mail_domains d ON d.id=m.domain_id WHERE m.email=lower('%u') AND m.enabled=true AND d.enabled=true
iterate_query = SELECT email AS username FROM mailboxes WHERE enabled=true
EOF
chmod 0600 /etc/dovecot/dovecot-sql.conf.ext

cat >/etc/dovecot/dovecot.conf <<EOF
protocols = imap lmtp
listen = *
mail_location = maildir:~/Maildir
mail_uid = crakmail
mail_gid = crakmail
first_valid_uid = 5000
last_valid_uid = 5000

ssl = required
ssl_min_protocol = TLSv1.2
ssl_cert = <${TLS_CERT}
ssl_key = <${TLS_KEY}
disable_plaintext_auth = yes
auth_mechanisms = plain login
auth_username_format = %Lu

passdb {
  driver = sql
  args = /etc/dovecot/dovecot-sql.conf.ext
}
userdb {
  driver = sql
  args = /etc/dovecot/dovecot-sql.conf.ext
}

mail_plugins = quota
plugin {
  quota = maildir:User quota
}

namespace inbox {
  inbox = yes
  separator = /
  mailbox Drafts { auto = subscribe special_use = \\Drafts }
  mailbox Sent { auto = subscribe special_use = \\Sent }
  mailbox Trash { auto = subscribe special_use = \\Trash }
  mailbox Junk { auto = subscribe special_use = \\Junk }
}

service imap-login {
  inet_listener imap { port = 0 }
  inet_listener imaps { port = 993 ssl = yes }
  process_min_avail = 1
  service_count = 1
}
service auth {
  unix_listener /var/spool/postfix/private/auth {
    mode = 0660
    user = postfix
    group = postfix
  }
}
service lmtp {
  unix_listener /var/spool/postfix/private/dovecot-lmtp {
    mode = 0600
    user = postfix
    group = postfix
  }
}
protocol imap {
  mail_plugins = \$mail_plugins imap_quota
}
protocol lmtp {
  mail_plugins = \$mail_plugins quota
  postmaster_address = postmaster@${MAIL_DOMAIN}
}

log_path = /dev/stderr
info_log_path = /dev/stdout
auth_verbose = no
EOF

# Configure Postfix through postconf so the packaged master/service defaults remain intact.
postconf -e "compatibility_level = 3.6"
postconf -e "myhostname = ${MAIL_HOSTNAME}"
postconf -e "mydomain = ${MAIL_DOMAIN}"
postconf -e 'myorigin = $mydomain'
postconf -e 'mydestination = localhost.$mydomain, localhost'
postconf -e 'inet_interfaces = all'
postconf -e 'inet_protocols = ipv4'
postconf -e "smtpd_banner = ${MAIL_HOSTNAME} ESMTP CrakMail"
postconf -e 'biff = no'
postconf -e 'append_dot_mydomain = no'
postconf -e 'readme_directory = no'
postconf -e 'maillog_file = /dev/stdout'
postconf -e 'message_size_limit = 52428800'
postconf -e 'mailbox_size_limit = 0'
postconf -e 'recipient_delimiter = +'
postconf -e 'disable_vrfy_command = yes'
postconf -e 'smtpd_helo_required = yes'
postconf -e 'smtpd_delay_reject = yes'
postconf -e 'smtpd_client_connection_rate_limit = 60'
postconf -e 'anvil_rate_time_unit = 60s'
postconf -e 'default_process_limit = 50'
postconf -e 'smtp_destination_concurrency_limit = 10'
postconf -e 'virtual_mailbox_base = /var/mail/vhosts'
postconf -e 'virtual_uid_maps = static:5000'
postconf -e 'virtual_gid_maps = static:5000'
postconf -e 'virtual_minimum_uid = 5000'
postconf -e 'virtual_mailbox_domains = pgsql:/etc/postfix/pgsql-virtual-mailbox-domains.cf'
postconf -e 'virtual_mailbox_maps = pgsql:/etc/postfix/pgsql-virtual-mailbox-maps.cf'
postconf -e 'virtual_alias_maps = pgsql:/etc/postfix/pgsql-virtual-alias-maps.cf'
postconf -e 'virtual_transport = lmtp:unix:private/dovecot-lmtp'
postconf -e 'smtpd_sasl_type = dovecot'
postconf -e 'smtpd_sasl_path = private/auth'
postconf -e 'smtpd_sasl_auth_enable = yes'
postconf -e 'smtpd_sasl_security_options = noanonymous'
postconf -e "smtpd_tls_cert_file = ${TLS_CERT}"
postconf -e "smtpd_tls_key_file = ${TLS_KEY}"
postconf -e 'smtpd_tls_security_level = may'
postconf -e 'smtpd_tls_auth_only = yes'
postconf -e 'smtpd_tls_loglevel = 1'
postconf -e 'smtp_tls_security_level = may'
postconf -e 'smtp_tls_loglevel = 1'
postconf -e 'smtpd_relay_restrictions = permit_mynetworks, permit_sasl_authenticated, reject_unauth_destination'
postconf -e 'smtpd_recipient_restrictions = permit_mynetworks, permit_sasl_authenticated, reject_non_fqdn_recipient, reject_unknown_recipient_domain, reject_unauth_destination'
# Trust only loopback plus the usual Docker private bridge range. Public clients must authenticate on 465/587.
postconf -e 'mynetworks = 127.0.0.0/8, 172.16.0.0/12'
postconf -e 'relay_domains ='
postconf -e 'smtpd_milters = inet:127.0.0.1:8891'
postconf -e 'non_smtpd_milters = inet:127.0.0.1:8891'
postconf -e 'milter_default_action = accept'
postconf -e 'milter_protocol = 6'

# Ensure the public SMTP listener is not chrooted; PostgreSQL maps and Dovecot sockets live in the container filesystem.
postconf -M 'smtp/inet=smtp inet n - n - - smtpd'

# Authenticated STARTTLS submission on 587.
postconf -M 'submission/inet=submission inet n - n - - smtpd'
postconf -P 'submission/inet/syslog_name=postfix/submission'
postconf -P 'submission/inet/smtpd_tls_security_level=encrypt'
postconf -P 'submission/inet/smtpd_sasl_auth_enable=yes'
postconf -P 'submission/inet/smtpd_relay_restrictions=permit_sasl_authenticated,reject'
postconf -P 'submission/inet/smtpd_recipient_restrictions=permit_sasl_authenticated,reject'
postconf -P 'submission/inet/milter_macro_daemon_name=ORIGINATING'

# Implicit TLS submission on 465 for clients that prefer it.
postconf -M 'submissions/inet=submissions inet n - n - - smtpd'
postconf -P 'submissions/inet/syslog_name=postfix/submissions'
postconf -P 'submissions/inet/smtpd_tls_wrappermode=yes'
postconf -P 'submissions/inet/smtpd_sasl_auth_enable=yes'
postconf -P 'submissions/inet/smtpd_relay_restrictions=permit_sasl_authenticated,reject'
postconf -P 'submissions/inet/smtpd_recipient_restrictions=permit_sasl_authenticated,reject'
postconf -P 'submissions/inet/milter_macro_daemon_name=ORIGINATING'

mkdir -p /etc/opendkim
cat >/etc/opendkim/opendkim.conf <<EOF
Syslog                  no
SyslogSuccess           no
LogWhy                   no
UMask                    007
Mode                     sv
Canonicalization         relaxed/simple
OversignHeaders          From
Socket                   inet:8891@127.0.0.1
PidFile                  /run/opendkim/opendkim.pid
UserID                   opendkim:opendkim
KeyTable                 refile:/var/lib/crakmail/KeyTable
SigningTable             refile:/var/lib/crakmail/SigningTable
ExternalIgnoreList       refile:/var/lib/crakmail/InternalHosts
InternalHosts            refile:/var/lib/crakmail/InternalHosts
EOF
mkdir -p /run/opendkim
chown opendkim:opendkim /run/opendkim
: >/var/lib/crakmail/KeyTable
: >/var/lib/crakmail/SigningTable
cat >/var/lib/crakmail/InternalHosts <<'EOF'
127.0.0.1
localhost
172.16.0.0/12
EOF
chown -R opendkim:opendkim /var/lib/crakmail/dkim /var/lib/crakmail/KeyTable /var/lib/crakmail/SigningTable /var/lib/crakmail/InternalHosts

# Generate the first DKIM keys before OpenDKIM starts.
CRAKMAIL_SYNC_ONCE=1 /usr/local/bin/crakmail-sync-dkim

newaliases || true
postfix check
dovecot -n >/dev/null

echo "CrakMail: ${MAIL_HOSTNAME} ready to start (SMTP 25/465/587, IMAPS 993)."
exec /usr/bin/supervisord -c /etc/supervisord.conf
