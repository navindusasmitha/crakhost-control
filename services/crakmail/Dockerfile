FROM debian:bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
    adduser bash ca-certificates gettext-base netcat-openbsd openssl procps supervisor postgresql-client \
    postfix postfix-pgsql dovecot-core dovecot-imapd dovecot-lmtpd dovecot-pgsql \
    opendkim opendkim-tools \
 && rm -rf /var/lib/apt/lists/* \
 && addgroup --system --gid 5000 crakmail \
 && adduser --system --uid 5000 --ingroup crakmail --no-create-home --home /var/mail/vhosts crakmail \
 && mkdir -p /var/mail/vhosts /var/lib/crakmail/dkim /run/dovecot /var/spool/postfix/private \
 && chown -R crakmail:crakmail /var/mail/vhosts \
 && chmod 0750 /var/mail/vhosts

COPY services/crakmail/entrypoint.sh /usr/local/bin/crakmail-entrypoint
COPY services/crakmail/sync-dkim.sh /usr/local/bin/crakmail-sync-dkim
COPY services/crakmail/supervisord.conf /etc/supervisord.conf
RUN chmod 0755 /usr/local/bin/crakmail-entrypoint /usr/local/bin/crakmail-sync-dkim

VOLUME ["/var/mail/vhosts","/var/lib/crakmail"]
EXPOSE 25 465 587 993

HEALTHCHECK --interval=15s --timeout=5s --start-period=25s --retries=8 \
  CMD nc -z 127.0.0.1 25 && nc -z 127.0.0.1 587 && nc -z 127.0.0.1 993 || exit 1

ENTRYPOINT ["/usr/local/bin/crakmail-entrypoint"]
