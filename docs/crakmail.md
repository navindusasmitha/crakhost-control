# CrakMail v0.47

CrakMail is the lightweight self-hosted mail layer for CrakHost Control. It uses Postfix for SMTP, Dovecot for IMAP/LMTP and SASL authentication, OpenDKIM for signing, PostgreSQL-backed domains/mailboxes/aliases, and Roundcube Elastic for webmail.

## Public ports

- 25/tcp — SMTP server-to-server delivery
- 465/tcp — authenticated SMTP over implicit TLS
- 587/tcp — authenticated SMTP submission with STARTTLS
- 993/tcp — IMAP over TLS

Roundcube binds only to `127.0.0.1:8888`; host Nginx publishes it at `https://mail.<domain>`.

## DNS order

Before running the installer, create the A record for the mail hostname and wait for it to resolve to the VPS public IPv4:

```text
A    mail.example.com              203.0.113.10
```

Then run:

```bash
sudo bash scripts/install-crakmail-host.sh example.com 203.0.113.10
```

After CrakMail starts, open **Admin → Mail Hosting** and copy the generated records:

```text
MX   example.com                   10 mail.example.com.
TXT  example.com                   v=spf1 ... -all
TXT  mail._domainkey.example.com   <generated DKIM public key>
TXT  _dmarc.example.com            v=DMARC1; p=none; ...
```

Set PTR/reverse DNS at the VPS provider, not at the normal DNS provider:

```text
203.0.113.10 -> mail.example.com
```

Keep DMARC at `p=none` while validating SPF/DKIM and real delivery. Move to `quarantine` and later `reject` after alignment is confirmed.

## Port 25 check

Run:

```bash
bash scripts/check-crakmail-network.sh
```

Or test directly before installation:

```bash
timeout 8 bash -c 'exec 3<>/dev/tcp/gmail-smtp-in.l.google.com/25; head -n1 <&3'
```

A `220 ... ESMTP` response confirms outbound TCP/25 is reachable. A timeout usually means a provider anti-spam restriction, cloud firewall, or host firewall rule.

Check host firewall state with:

```bash
sudo ufw status verbose
sudo iptables -S OUTPUT
```

If UFW is active, allow the required mail ports:

```bash
sudo ufw allow 25/tcp
sudo ufw allow 465/tcp
sudo ufw allow 587/tcp
sudo ufw allow 993/tcp
```

If the host firewall permits the traffic but outbound TCP/25 still times out, use the VPS provider's anti-spam/unblock flow or contact the provider. Do not route around a provider abuse restriction; fix the cause and request removal.

## Mailboxes and aliases

Create mailboxes in **Admin → Mail Hosting**. Users sign in with their full email address. Mailbox passwords are stored as salted SSHA512 hashes; plaintext passwords are never stored.

Recommended operational addresses:

```text
postmaster@example.com
abuse@example.com
support@example.com
billing@example.com
noreply@example.com
```

Aliases in v0.47 intentionally deliver only to enabled local CrakMail mailboxes.

## Client settings

```text
IMAP host: mail.example.com
IMAP port: 993
Security: SSL/TLS

SMTP host: mail.example.com
SMTP port: 587
Security: STARTTLS
Authentication: required
Username: full email address
```

## Webmail

Roundcube Elastic is available at:

```text
https://mail.example.com
```

## CrakHost transactional sender

In **Admin → Mail Hosting**, choose an enabled mailbox and select **Use as sender**. CrakHost Control then sends transactional templates to the private Docker-network endpoint `crakmail:25`; public clients still require TLS + authentication on ports 465/587.

## Backups

Back up these Docker volumes in addition to PostgreSQL:

```text
crakhost-mail-vhosts     Maildir message data
crakhost-mail-state      DKIM private/public keys and signing maps
crakhost-roundcube-db    Roundcube SQLite preferences/address-book state
```

Losing the DKIM private-key volume requires generating a new key and updating the public DKIM DNS record.

## Lightweight-mode limitation

v0.47 deliberately does not bundle ClamAV or a full spam-filter engine so the mail core stays lightweight. Authentication, TLS, relay restrictions, DKIM signing, SPF/DMARC guidance, connection limits and local-only aliases are included. Add an anti-spam layer only after the core delivery path is verified and resource budget is known.
