#!/usr/bin/env bash
set -Eeuo pipefail

# Debian's Postfix defaults chroot several worker processes. Inside Docker, the
# chroot does not have access to Docker's embedded resolver (127.0.0.11), which
# breaks PostgreSQL service-name lookups and outbound MX/DNS resolution. Keep
# only the workers that need Docker DNS outside the Postfix chroot.
postconf -e 'virtual_alias_domains ='
postconf -M 'rewrite/unix=rewrite unix - - n - - trivial-rewrite'
postconf -M 'cleanup/unix=cleanup unix n - n - 0 cleanup'
postconf -M 'smtp/unix=smtp unix - - n - - smtp'
postconf -M 'relay/unix=relay unix - - n - - smtp'

exec /usr/sbin/postfix start-fg
