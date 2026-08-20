# 🚀 CrakHost Control — Complete Version History & Documentation

Welcome to the consolidated release notes and installation manual for **CrakHost Control**.

---

### 🌟 Key Highlights

* **v0.13 (Production VPS Edition):** Caddy HTTPS domain overlay, fully Dockerized panel, Minecraft & FiveM production templates, GitHub release workflow, one-command Linux installer, backup-first updater, and in-panel update checker.
* **v0.12 (Infrastructure & Security):** Infrastructure Center, database host registry, server migration jobs, reseller ownership foundation, TOTP/2FA schema, SFTP credential schema, and conflict-safe Windows upgrade script.
* **v0.11 (Operations & Health):** Operations Center, Docker external volume fixes, CrakNode `/diagnostics` endpoint, admin server ownership transfers, and configurable maintenance mode.

---

### 📊 Comprehensive Feature Matrix

| Feature / Capability | 📦 v0.11 | 🔐 v0.12 | 🌐 v0.13 |
| :--- | :---: | :---: | :---: |
| **Primary Target Platform** | Node / Docker | Windows / Dev | Production VPS (Linux) |
| **Installer & Updaters** | Manual / Script | PowerShell Upgrade | One-Command Linux Installer |
| **Reverse Proxy & SSL** | — | — | Caddy Auto-HTTPS Overlay |
| **Game Server Templates** | — | — | Minecraft & FiveM |
| **Management Dashboard** | Operations Center | Infrastructure Center | In-Panel Update Checker |
| **Security & Auth** | Node Auth | TOTP/2FA & SFTP Schema | Docker Security Boundary |
| **Node Diagnostics** | Agent v0.11.0 | Node Capacity Metrics | Snapshot History Foundation |
| **Database Management** | Basic DB Host | Host Registry Schema | Backup-First PostgreSQL |

---

### ⚡ Quick Setup & Deployment

#### 🐧 Linux Production VPS (v0.13)
Run the one-line installer directly on your VPS:
```bash
curl -fsSL [https://raw.githubusercontent.com/OWNER/REPO/main/install.sh](https://raw.githubusercontent.com/OWNER/REPO/main/install.sh) | sudo bash
