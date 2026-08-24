#!/usr/bin/env bash
set -Eeuo pipefail

# Postfix's Debian defaults chroot the rewrite and cleanup services. Those
# processes need Docker's embedded DNS to resolve the PostgreSQL service name
# used by the pgsql maps, so keep only these lookup workers outside the chroot.
postconf -e 'virtual_alias_domains ='
postconf -M 'rewrite/unix=rewrite unix - - n - - trivial-rewrite'
postconf -M 'cleanup/unix=cleanup unix n - n - 0 cleanup'

exec /usr/sbin/postfix start-fg
