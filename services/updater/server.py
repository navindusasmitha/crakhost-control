#!/usr/bin/env python3
import hmac
import json
import os
import re
import shutil
import socketserver
import subprocess
import threading
import time
import uuid
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler
from pathlib import Path

VERSION = "0.56.0"
SOCKET_PATH = Path(os.getenv("CRAKHOST_UPDATER_SOCKET", "/run/crakhost-updater/updater.sock"))
STATE_PATH = Path(os.getenv("CRAKHOST_UPDATER_STATE", "/var/lib/crakhost-updater/state.json"))
HISTORY_PATH = Path(os.getenv("CRAKHOST_UPDATER_HISTORY", "/var/lib/crakhost-updater/history.json"))
LOG_PATH = Path(os.getenv("CRAKHOST_UPDATER_LOG", "/var/log/crakhost/updater.log"))
UPDATE_SCRIPT = os.getenv("CRAKHOST_UPDATE_SCRIPT", "/opt/crakhost/scripts/update-production.sh")
MAINTENANCE_SCRIPT = os.getenv("CRAKHOST_MAINTENANCE_SCRIPT", "/opt/crakhost/scripts/maintenance-cleanup.sh")
UPDATE_ROOT = os.getenv("CRAKHOST_UPDATE_ROOT", "/opt/crakhost")
BACKUP_ROOT = Path(os.getenv("CRAKHOST_BACKUP_ROOT", "/var/backups/crakhost"))
COMPOSE_PROJECT = os.getenv("CRAKHOST_COMPOSE_PROJECT", "crakhost-control")
TOKEN = os.getenv("CRAKHOST_DEPLOY_TOKEN", "")
LOCK = threading.RLock()
ONE_SHOT_SERVICES = {"migrate"}
RESTARTABLE_SERVICES = {"craknode", "commerce-cleanup", "crakmail", "roundcube"}


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def default_state():
    return {
        "status": "idle",
        "job_id": None,
        "job_kind": None,
        "pid": None,
        "started_at": None,
        "finished_at": None,
        "exit_code": None,
        "agent_version": VERSION,
        "storage_before": None,
        "cleanup_summary": None,
    }


def load_state():
    try:
        data = json.loads(STATE_PATH.read_text(encoding="utf-8"))
        if not isinstance(data, dict):
            return default_state()
        return {**default_state(), **data, "agent_version": VERSION}
    except Exception:
        return default_state()


def save_state(state):
    STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
    tmp = STATE_PATH.with_suffix(".tmp")
    tmp.write_text(json.dumps(state, indent=2), encoding="utf-8")
    os.replace(tmp, STATE_PATH)


def load_history():
    try:
        data = json.loads(HISTORY_PATH.read_text(encoding="utf-8"))
        return data if isinstance(data, list) else []
    except Exception:
        return []


def append_history(entry):
    HISTORY_PATH.parent.mkdir(parents=True, exist_ok=True)
    history = [entry, *load_history()][:20]
    tmp = HISTORY_PATH.with_suffix(".tmp")
    tmp.write_text(json.dumps(history, indent=2), encoding="utf-8")
    os.replace(tmp, HISTORY_PATH)


def pid_alive(pid):
    if not isinstance(pid, int) or pid <= 0:
        return False
    try:
        os.kill(pid, 0)
        return True
    except OSError:
        return False


def normalized_state():
    with LOCK:
        state = load_state()
        if state.get("status") == "running" and not pid_alive(state.get("pid")):
            state["status"] = "interrupted"
            state["finished_at"] = state.get("finished_at") or now_iso()
            save_state(state)
        return state


def tail_log(max_bytes=65536, max_lines=180):
    try:
        with LOG_PATH.open("rb") as handle:
            handle.seek(0, os.SEEK_END)
            size = handle.tell()
            handle.seek(max(0, size - max_bytes))
            text = handle.read().decode("utf-8", errors="replace")
        return "\n".join(text.splitlines()[-max_lines:])
    except FileNotFoundError:
        return ""


def append_log(text):
    LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
    with LOG_PATH.open("a", encoding="utf-8") as handle:
        handle.write(text)
        if not text.endswith("\n"):
            handle.write("\n")


def watch_process(proc, job_id):
    code = proc.wait()
    with LOCK:
        state = load_state()
        if state.get("job_id") != job_id:
            return
        state["status"] = "success" if code == 0 else "failed"
        state["finished_at"] = now_iso()
        state["exit_code"] = code
        state["pid"] = None
        if state.get("job_kind") == "maintenance" and code == 0:
            after = storage_snapshot()
            before = state.get("storage_before") or {}
            if after:
                state["cleanup_summary"] = {
                    "disk_used_before_bytes": before.get("disk_used_bytes"),
                    "disk_used_after_bytes": after.get("disk_used_bytes"),
                    "disk_reclaimed_bytes": max(0, int(before.get("disk_used_bytes") or 0) - int(after.get("disk_used_bytes") or 0)),
                    "docker_reclaimable_before_bytes": before.get("docker_reclaimable_bytes"),
                    "docker_reclaimable_after_bytes": after.get("docker_reclaimable_bytes"),
                    "finished_at": state.get("finished_at"),
                }
        save_state(state)
        append_history({
            "job_id": state.get("job_id"),
            "job_kind": state.get("job_kind"),
            "status": state.get("status"),
            "started_at": state.get("started_at"),
            "finished_at": state.get("finished_at"),
            "exit_code": code,
            "cleanup_summary": state.get("cleanup_summary"),
        })
    append_log(f"[Updater Agent] Job {job_id} finished with exit code {code}.")


def start_job(kind, script_path, extra_env=None):
    script = Path(script_path)
    if not script.is_file():
        return None, f"{kind.title()} script is missing."

    with LOCK:
        state = normalized_state()
        if state.get("status") == "running":
            return state, "Another privileged CrakHost job is already running."

        job_id = uuid.uuid4().hex
        append_log("\n" + "=" * 72 + f"\n[Updater Agent] Starting {kind} job {job_id} at {now_iso()}\n")
        log_handle = LOG_PATH.open("a", encoding="utf-8")
        env = os.environ.copy()
        if extra_env:
            env.update(extra_env)
        env["CRAKHOST_UPDATE_JOB_ID"] = job_id
        try:
            proc = subprocess.Popen(
                ["/usr/bin/bash", str(script)],
                cwd=UPDATE_ROOT,
                env=env,
                stdout=log_handle,
                stderr=subprocess.STDOUT,
                text=True,
                start_new_session=True,
            )
        except Exception as exc:
            log_handle.close()
            return None, f"Unable to launch {kind}: {exc}"

        state = {
            "status": "running",
            "job_id": job_id,
            "job_kind": kind,
            "pid": proc.pid,
            "started_at": now_iso(),
            "finished_at": None,
            "exit_code": None,
            "agent_version": VERSION,
            "storage_before": storage_snapshot() if kind == "maintenance" else None,
            "cleanup_summary": None,
        }
        save_state(state)
        threading.Thread(target=watch_process, args=(proc, job_id), daemon=True).start()
        log_handle.close()
        return state, None


def run_command(args, timeout=6):
    try:
        result = subprocess.run(args, capture_output=True, text=True, timeout=timeout, check=False)
        return result.returncode, result.stdout.strip(), result.stderr.strip()
    except Exception as exc:
        return 1, "", str(exc)


def restart_service(service):
    service = str(service or "").strip().lower()
    if service not in RESTARTABLE_SERVICES:
        return None, "Service is not approved for in-panel restart."
    with LOCK:
        state = normalized_state()
        if state.get("status") == "running":
            return None, "A privileged update or maintenance job is currently running."
    code, out, err = run_command([
        "docker", "ps", "-a",
        "--filter", f"label=com.docker.compose.project={COMPOSE_PROJECT}",
        "--filter", f"label=com.docker.compose.service={service}",
        "--format", "{{.ID}}",
    ], timeout=8)
    if code != 0:
        return None, err or "Unable to locate service container."
    container_ids = [line.strip() for line in out.splitlines() if line.strip()]
    if not container_ids:
        return None, f"No container found for service {service}."
    started = now_iso()
    append_log(f"[Updater Agent] Restricted restart requested for service {service} at {started}.")
    for container_id in container_ids:
        code, _, err = run_command(["docker", "restart", container_id], timeout=45)
        if code != 0:
            append_history({"job_id": uuid.uuid4().hex, "job_kind": "service_restart", "service": service, "status": "failed", "started_at": started, "finished_at": now_iso(), "exit_code": code})
            return None, err or f"Failed to restart {service}."
    finished = now_iso()
    job_id = uuid.uuid4().hex
    append_history({"job_id": job_id, "job_kind": "service_restart", "service": service, "status": "success", "started_at": started, "finished_at": finished, "exit_code": 0})
    append_log(f"[Updater Agent] Restricted restart completed for service {service}.")
    return {"ok": True, "job_id": job_id, "job_kind": "service_restart", "service": service, "status": "success", "started_at": started, "finished_at": finished, "exit_code": 0, "agent_version": VERSION}, None


def read_cpu_snapshot():
    fields = Path("/proc/stat").read_text(encoding="utf-8").splitlines()[0].split()[1:]
    values = [int(x) for x in fields]
    idle = values[3] + (values[4] if len(values) > 4 else 0)
    return sum(values), idle


def cpu_percent():
    try:
        total1, idle1 = read_cpu_snapshot()
        time.sleep(0.12)
        total2, idle2 = read_cpu_snapshot()
        delta_total = total2 - total1
        delta_idle = idle2 - idle1
        return round(max(0.0, min(100.0, 100.0 * (delta_total - delta_idle) / max(1, delta_total))), 1)
    except Exception:
        return None


def memory_metrics():
    values = {}
    try:
        for line in Path("/proc/meminfo").read_text(encoding="utf-8").splitlines():
            key, raw = line.split(":", 1)
            values[key] = int(raw.strip().split()[0]) * 1024
        total = values.get("MemTotal", 0)
        available = values.get("MemAvailable", values.get("MemFree", 0))
        used = max(0, total - available)
        percent = round(used * 100 / total, 1) if total else None
        return {"total_bytes": total, "used_bytes": used, "available_bytes": available, "percent": percent}
    except Exception:
        return {"total_bytes": 0, "used_bytes": 0, "available_bytes": 0, "percent": None}


def directory_size(path):
    if not path.exists():
        return 0
    code, out, _ = run_command(["du", "-sb", str(path)], timeout=8)
    if code == 0 and out:
        try:
            return int(out.split()[0])
        except Exception:
            pass
    return None


def docker_df():
    code, out, err = run_command(["docker", "system", "df", "--format", "{{json .}}"], timeout=8)
    if code != 0:
        return [], err or "docker system df failed"
    records = []
    for line in out.splitlines():
        try:
            value = json.loads(line)
            if isinstance(value, dict):
                records.append(value)
        except Exception:
            continue
    return records, None


def parse_size_bytes(raw):
    text = str(raw or "").strip()
    if not text:
        return 0
    token = text.split()[0]
    match = re.match(r"^([0-9]+(?:\.[0-9]+)?)([kKmMgGtTpP]?[iI]?[bB])?$", token)
    if not match:
        return 0
    value = float(match.group(1))
    unit = (match.group(2) or "B").upper().replace("IB", "B")
    factors = {"B": 1, "KB": 1024, "MB": 1024**2, "GB": 1024**3, "TB": 1024**4, "PB": 1024**5}
    return int(value * factors.get(unit, 1))


def storage_snapshot():
    try:
        disk = shutil.disk_usage("/")
    except Exception:
        return None
    docker_usage, _ = docker_df()
    reclaimable_bytes = sum(parse_size_bytes(item.get("Reclaimable")) for item in docker_usage)
    return {
        "disk_total_bytes": disk.total,
        "disk_used_bytes": disk.used,
        "disk_free_bytes": disk.free,
        "docker_reclaimable_bytes": reclaimable_bytes,
        "captured_at": now_iso(),
    }


def classify_service(service, raw_status):
    service_name = str(service or "").lower()
    status = str(raw_status or "")
    lowered = status.lower()
    if service_name in ONE_SHOT_SERVICES and lowered.startswith("exited (0)"):
        return "completed", "Up · completed successfully"
    if "unhealthy" in lowered or lowered.startswith("dead") or lowered.startswith("exited"):
        return "error", status
    if lowered.startswith("up"):
        return "healthy", status
    return "unknown", status


def docker_services():
    template = '{{.Names}}\t{{.Status}}\t{{.Label "com.docker.compose.service"}}'
    code, out, err = run_command([
        "docker", "ps", "-a",
        "--filter", f"label=com.docker.compose.project={COMPOSE_PROJECT}",
        "--format", template,
    ], timeout=8)
    if code != 0:
        return [], err or "docker ps failed"
    services = []
    for line in out.splitlines():
        parts = line.split("\t")
        if len(parts) >= 3:
            service = parts[2] or parts[0]
            state, display_status = classify_service(service, parts[1])
            services.append({
                "name": parts[0],
                "status": display_status,
                "raw_status": parts[1],
                "service": service,
                "state": state,
                "restartable": service in RESTARTABLE_SERVICES,
            })
    services.sort(key=lambda x: x.get("service", ""))
    return services, None


def collect_metrics():
    disk = shutil.disk_usage("/")
    disk_percent = round(disk.used * 100 / disk.total, 1) if disk.total else None
    memory = memory_metrics()
    docker_usage, docker_error = docker_df()
    services, services_error = docker_services()
    warnings = []
    critical = False
    if disk_percent is not None and disk_percent >= 90:
        warnings.append(f"Root disk usage is critical at {disk_percent}%.")
        critical = True
    elif disk_percent is not None and disk_percent >= 80:
        warnings.append(f"Root disk usage is elevated at {disk_percent}%.")
    if disk.free < 8 * 1024**3:
        warnings.append("Less than 8 GiB is free on the root filesystem.")
        critical = True
    if memory.get("percent") is not None and memory["percent"] >= 95:
        warnings.append(f"Memory usage is critical at {memory['percent']}%.")
        critical = True
    elif memory.get("percent") is not None and memory["percent"] >= 90:
        warnings.append(f"Memory usage is high at {memory['percent']}%.")
    for service in services:
        if service.get("state") == "error":
            warnings.append(f"Service {service.get('service')} reports {service.get('raw_status') or service.get('status')}.")
            critical = True
    reclaimable_bytes = sum(parse_size_bytes(item.get("Reclaimable")) for item in docker_usage)
    cleanup_recommended = (
        reclaimable_bytes >= 20 * 1024**3
        or (reclaimable_bytes >= 8 * 1024**3 and ((disk_percent or 0) >= 70 or disk.free < 20 * 1024**3))
    )
    if cleanup_recommended:
        warnings.append("Docker storage pressure is elevated; Safe cleanup is recommended.")
    if docker_error:
        warnings.append(f"Docker storage metrics unavailable: {docker_error}")
    if services_error:
        warnings.append(f"Docker service metrics unavailable: {services_error}")
    try:
        load = [round(x, 2) for x in os.getloadavg()]
    except Exception:
        load = []
    try:
        uptime = int(float(Path("/proc/uptime").read_text(encoding="utf-8").split()[0]))
    except Exception:
        uptime = None
    health_status = "critical" if critical else "warning" if warnings else "healthy"
    return {
        "ok": True,
        "agent_version": VERSION,
        "health_status": health_status,
        "cpu_percent": cpu_percent(),
        "memory": memory,
        "disk": {
            "total_bytes": disk.total,
            "used_bytes": disk.used,
            "free_bytes": disk.free,
            "percent": disk_percent,
        },
        "backup_bytes": directory_size(BACKUP_ROOT),
        "load": load,
        "uptime_seconds": uptime,
        "docker_df": docker_usage,
        "docker_reclaimable_bytes": reclaimable_bytes,
        "docker_cleanup_recommended": cleanup_recommended,
        "services": services,
        "restartable_services": sorted(RESTARTABLE_SERVICES),
        "warnings": warnings,
        "collected_at": now_iso(),
    }


class Handler(BaseHTTPRequestHandler):
    server_version = f"CrakHostUpdater/{VERSION}"

    def log_message(self, *_):
        return

    def authorized(self):
        supplied = self.headers.get("x-crakhost-deploy-token", "")
        return bool(TOKEN) and hmac.compare_digest(supplied, TOKEN)

    def send_json(self, status, payload):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(body)))
        self.send_header("cache-control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def require_auth(self):
        if not self.authorized():
            self.send_json(401, {"error": "Unauthorized updater request."})
            return False
        return True

    def do_GET(self):
        if not self.require_auth():
            return
        if self.path == "/health":
            state = normalized_state()
            self.send_json(200, {"ok": True, "service": "crakhost-updater", "agent_version": VERSION, "status": state.get("status")})
            return
        if self.path == "/status":
            state = normalized_state()
            self.send_json(200, {**state, "history": load_history(), "log_tail": tail_log()})
            return
        if self.path == "/metrics":
            self.send_json(200, collect_metrics())
            return
        self.send_json(404, {"error": "Not found."})

    def do_POST(self):
        if not self.require_auth():
            return
        length = int(self.headers.get("content-length", "0") or "0")
        if length > 4096:
            self.send_json(413, {"error": "Request body too large."})
            return
        if length:
            self.rfile.read(length)

        if self.path == "/update":
            state, error = start_job("update", UPDATE_SCRIPT, {"CRAKHOST_UPDATE_SOURCE": "panel"})
        elif self.path == "/maintenance/cleanup":
            state, error = start_job("maintenance", MAINTENANCE_SCRIPT, {"CRAKHOST_MAINTENANCE_SOURCE": "panel"})
        elif self.path.startswith("/service/restart/"):
            service = self.path.rsplit("/", 1)[-1]
            result, restart_error = restart_service(service)
            if restart_error:
                status = 409 if "currently running" in restart_error else 400 if "approved" in restart_error else 500
                self.send_json(status, {"error": restart_error, "service": service, "agent_version": VERSION})
            else:
                self.send_json(200, result)
            return
        else:
            self.send_json(404, {"error": "Not found."})
            return

        if error and state and state.get("status") == "running":
            self.send_json(409, {**state, "error": error, "history": load_history(), "log_tail": tail_log()})
            return
        if error:
            self.send_json(500, {"error": error, "status": "failed", "history": load_history(), "log_tail": tail_log()})
            return
        self.send_json(202, {**state, "history": load_history(), "log_tail": tail_log()})


class UnixHTTPServer(socketserver.ThreadingMixIn, socketserver.UnixStreamServer):
    daemon_threads = True


def main():
    if len(TOKEN) < 32 or TOKEN.startswith("replace-with-"):
        raise SystemExit("CRAKHOST_DEPLOY_TOKEN is missing or unsafe.")
    SOCKET_PATH.parent.mkdir(parents=True, exist_ok=True)
    STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
    HISTORY_PATH.parent.mkdir(parents=True, exist_ok=True)
    LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
    try:
        SOCKET_PATH.unlink()
    except FileNotFoundError:
        pass
    normalized_state()
    with UnixHTTPServer(str(SOCKET_PATH), Handler) as server:
        os.chmod(SOCKET_PATH, 0o660)
        append_log(f"[Updater Agent] v{VERSION} listening on {SOCKET_PATH} at {now_iso()}.")
        server.serve_forever(poll_interval=0.5)


if __name__ == "__main__":
    main()
