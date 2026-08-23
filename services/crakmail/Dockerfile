FROM alpine:3.22

RUN apk add --no-cache \
    bash ca-certificates gettext netcat-openbsd openssl supervisor postgresql-client \
    postfix postfix-pgsql dovecot dovecot-pgsql dovecot-lmtpd opendkim \
 && addgroup -g 5000 -S vmail \
 && adduser -u 5000 -S -D -H -G vmail vmail \
 && mkdir -p /var/mail/vhosts /var/lib/crakmail/dkim /run/dovecot /var/spool/postfix/private \
 && chown -R vmail:vmail /var/mail/vhosts \
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
