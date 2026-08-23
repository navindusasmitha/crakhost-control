# CrakMail v0.47

CrakMail is the self-hosted mail profile for CrakHost Control. It uses Docker Mailserver for SMTP/Submission/IMAP and SnappyMail for webmail. Heavy antivirus/spam engines are disabled by default to keep idle memory use low.

## Required public DNS

For domain `example.com` and VPS IP `203.0.113.10`:

- `A mail.example.com -> 203.0.113.10`
- `MX example.com -> mail.example.com` priority `10`
- `TXT example.com -> v=spf1 mx a ip4:203.0.113.10 -all`
- DKIM record from `scripts/mail/show-dns.sh example.com`
- `TXT _dmarc.example.com -> v=DMARC1; p=quarantine; adkim=s; aspf=s; rua=mailto:postmaster@example.com`
- PTR / reverse DNS at the VPS provider: `203.0.113.10 -> mail.example.com`

PTR is configured at the provider, not in the normal DNS zone.

## Port policy

Public inbound ports: TCP 25, 465, 587, 993. Webmail stays bound to `127.0.0.1:8888` and is published through the host Nginx TLS vhost.

Internet MTA-to-MTA delivery requires outbound TCP/25. User clients and CrakHost transactional mail should authenticate on 587 STARTTLS or 465 TLS.

Check outbound port 25:

```bash
bash scripts/mail/check-port25.sh
```

## Bootstrap

After `mail.<domain>` A record points at the VPS:

```bash
sudo bash scripts/mail/bootstrap.sh example.com
```

The bootstrap creates the lightweight mail environment, obtains a Let's Encrypt certificate, configures the Nginx webmail reverse proxy, starts the mail stack, creates `postmaster`, `support`, `billing` and `noreply` mailboxes, and generates DKIM.

Initial mailbox passwords are written once to `.crakmail-credentials` with mode 0600. Store them in a password manager and remove the file when no longer required.

## Connect CrakHost Mail Center

Use the local self-hosted server through authenticated submission:

- Host: `mail.example.com`
- Port: `587`
- Encryption: `STARTTLS`
- Username: `noreply@example.com`
- Password: mailbox password
- From email: `noreply@example.com`
- Reply-to: `support@example.com`
- TLS verification: enabled

## Webmail

Webmail URL: `https://mail.example.com`

IMAP: `mail.example.com:993` SSL/TLS

SMTP submission: `mail.example.com:587` STARTTLS

Never configure the Docker network as a trusted SMTP relay. Authenticated submission is required.
