#!/usr/bin/env python3
import hmac
import json
import os
import socketserver
import subprocess
import threading
import uuid
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler
from pathlib import Path

VERSION = "0.52.0"
SOCKET_PATH = Path(os.getenv("CRAKHOST_UPDATER_SOCKET", "/run/crakhost-updater/updater.sock"))
STATE_PATH = Path(os.getenv("CRAKHOST_UPDATER_STATE", "/var/lib/crakhost-updater/state.json"))
LOG_PATH = Path(os.getenv("CRAKHOST_UPDATER_LOG", "/var/log/crakhost/updater.log"))
UPDATE_SCRIPT = os.getenv("CRAKHOST_UPDATE_SCRIPT", "/opt/crakhost/scripts/update-production.sh")
UPDATE_ROOT = os.getenv("CRAKHOST_UPDATE_ROOT", "/opt/crakhost")
TOKEN = os.getenv("CRAKHOST_DEPLOY_TOKEN", "")
LOCK = threading.RLock()


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def default_state():
    return {
        "status": "idle",
        "job_id": None,
        "pid": None,
        "started_at": None,
        "finished_at": None,
        "exit_code": None,
        "agent_version": VERSION,
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
            state["exit_code"] = state.get("exit_code")
            save_state(state)
        return state


def tail_log(max_bytes=65536, max_lines=160):
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
        save_state(state)
    append_log(f"[Updater Agent] Job {job_id} finished with exit code {code}.")


def start_update():
    if not Path(UPDATE_SCRIPT).is_file():
        return None, "Update script is missing."

    with LOCK:
        state = normalized_state()
        if state.get("status") == "running":
            return state, "An update is already running."

        job_id = uuid.uuid4().hex
        append_log(
            "\n"
            + "=" * 72
            + f"\n[Updater Agent] Starting job {job_id} at {now_iso()}\n"
        )
        log_handle = LOG_PATH.open("a", encoding="utf-8")
        env = os.environ.copy()
        env["CRAKHOST_UPDATE_SOURCE"] = "panel"
        env["CRAKHOST_UPDATE_JOB_ID"] = job_id
        try:
            proc = subprocess.Popen(
                ["/usr/bin/bash", UPDATE_SCRIPT],
                cwd=UPDATE_ROOT,
                env=env,
                stdout=log_handle,
                stderr=subprocess.STDOUT,
                text=True,
                start_new_session=True,
            )
        except Exception as exc:
            log_handle.close()
            return None, f"Unable to launch updater: {exc}"

        state = {
            "status": "running",
            "job_id": job_id,
            "pid": proc.pid,
            "started_at": now_iso(),
            "finished_at": None,
            "exit_code": None,
            "agent_version": VERSION,
        }
        save_state(state)
        thread = threading.Thread(target=watch_process, args=(proc, job_id), daemon=True)
        thread.start()
        log_handle.close()
        return state, None


class Handler(BaseHTTPRequestHandler):
    server_version = "CrakHostUpdater/0.52"

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
            self.send_json(200, {
                "ok": True,
                "service": "crakhost-updater",
                "agent_version": VERSION,
                "status": state.get("status"),
            })
            return
        if self.path == "/status":
            state = normalized_state()
            self.send_json(200, {**state, "log_tail": tail_log()})
            return
        self.send_json(404, {"error": "Not found."})

    def do_POST(self):
        if not self.require_auth():
            return
        if self.path != "/update":
            self.send_json(404, {"error": "Not found."})
            return
        length = int(self.headers.get("content-length", "0") or "0")
        if length > 4096:
            self.send_json(413, {"error": "Request body too large."})
            return
        if length:
            self.rfile.read(length)

        state, error = start_update()
        if error and state and state.get("status") == "running":
            self.send_json(409, {**state, "error": error, "log_tail": tail_log()})
            return
        if error:
            self.send_json(500, {"error": error, "status": "failed", "log_tail": tail_log()})
            return
        self.send_json(202, {**state, "log_tail": tail_log()})


class UnixHTTPServer(socketserver.ThreadingMixIn, socketserver.UnixStreamServer):
    daemon_threads = True


def main():
    if len(TOKEN) < 32 or TOKEN.startswith("replace-with-"):
        raise SystemExit("CRAKHOST_DEPLOY_TOKEN is missing or unsafe.")

    SOCKET_PATH.parent.mkdir(parents=True, exist_ok=True)
    STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
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
