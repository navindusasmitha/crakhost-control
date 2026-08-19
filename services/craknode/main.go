package main

import (
	"compress/gzip"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path"
	"regexp"
	"strconv"
	"strings"
	"time"
)

const version = "0.11.0"

var safeID = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$`)

type api struct{ token string }
type actionBody struct {
	Action string `json:"action"`
}
type commandBody struct {
	Command string `json:"command"`
}
type createBody struct {
	Image         string            `json:"image"`
	MemoryMB      int               `json:"memoryMb"`
	CPU           float64           `json:"cpu"`
	HostPort      int               `json:"hostPort"`
	ContainerPort int               `json:"containerPort"`
	Env           map[string]string `json:"env"`
}
type fileBody struct {
	Path    string `json:"path"`
	Content string `json:"content"`
	Kind    string `json:"kind"`
}
type serverStatus struct {
	Status      string  `json:"status"`
	CPU         float64 `json:"cpu"`
	CPURaw      float64 `json:"cpuRaw,omitempty"`
	CPULimit    float64 `json:"cpuLimit,omitempty"`
	Memory      float64 `json:"memory"`
	MemoryLimit float64 `json:"memoryLimit"`
	Uptime      string  `json:"uptime"`
	Health      string  `json:"health,omitempty"`
}
type fileItem struct {
	Name     string `json:"name"`
	Path     string `json:"path"`
	Type     string `json:"type"`
	Size     int64  `json:"size"`
	Modified string `json:"modified"`
}

func main() {
	a := api{token: os.Getenv("CRAKNODE_TOKEN")}
	if a.token == "" {
		log.Println("WARNING: CRAKNODE_TOKEN is empty")
	}
	_ = os.MkdirAll(env("CRAKNODE_BACKUP_DIR", "/tmp/crakhost-backups"), 0750)
	mux := http.NewServeMux()
	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		jsonOut(w, 200, map[string]any{"name": "CrakNode", "version": version, "status": "online", "time": time.Now().UTC()})
	})
	mux.HandleFunc("/diagnostics", a.auth(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			methodNA(w)
			return
		}
		dockerVersion, _ := docker("version", "--format", "{{.Server.Version}}")
		managedRaw, _ := docker("ps", "-a", "--filter", "label=crakhost.managed=true", "--format", "{{.ID}}")
		runningRaw, _ := docker("ps", "--filter", "label=crakhost.managed=true", "--format", "{{.ID}}")
		managed, running := lineCount(managedRaw), lineCount(runningRaw)
		free := int64(0)
		if out, e := exec.Command("sh", "-c", "df -B1 / 2>/dev/null | awk 'NR==2 {print $4}'").Output(); e == nil {
			free, _ = strconv.ParseInt(strings.TrimSpace(string(out)), 10, 64)
		}
		jsonOut(w, 200, map[string]any{"name": "CrakNode", "version": version, "status": "online", "dockerVersion": strings.TrimSpace(dockerVersion), "managedContainers": managed, "runningContainers": running, "diskFreeBytes": free, "time": time.Now().UTC()})
	}))
	mux.HandleFunc("/v1/servers/", a.auth(a.serverRouter))
	addr := env("CRAKNODE_LISTEN", ":8088")
	log.Printf("CrakNode v%s listening on %s", version, addr)
	log.Fatal(http.ListenAndServe(addr, mux))
}
func (a api) auth(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if a.token != "" && r.Header.Get("Authorization") != "Bearer "+a.token {
			jsonOut(w, 401, map[string]string{"error": "unauthorized"})
			return
		}
		next(w, r)
	}
}
func (a api) serverRouter(w http.ResponseWriter, r *http.Request) {
	p := strings.TrimPrefix(r.URL.Path, "/v1/servers/")
	parts := strings.Split(p, "/")
	if len(parts) < 2 || !safeID.MatchString(parts[0]) {
		jsonOut(w, 404, map[string]string{"error": "invalid server identifier"})
		return
	}
	id, op := parts[0], parts[1]
	container := containerFor(id)
	switch op {
	case "status":
		a.only(w, r, http.MethodGet, func() { a.status(w, container) })
	case "logs":
		a.only(w, r, http.MethodGet, func() { a.logs(w, container) })
	case "action":
		a.only(w, r, http.MethodPost, func() { a.action(w, r, container) })
	case "command":
		a.only(w, r, http.MethodPost, func() { a.command(w, r, container) })
	case "create":
		a.only(w, r, http.MethodPost, func() { a.create(w, r, id, container) })
	case "files":
		a.files(w, r, container)
	case "backup":
		a.only(w, r, http.MethodPost, func() { a.backup(w, r, id, container) })
	case "restore":
		a.only(w, r, http.MethodPost, func() { a.restore(w, r, id, container) })
	case "delete":
		a.only(w, r, http.MethodPost, func() { a.deleteServer(w, container) })
	default:
		jsonOut(w, 404, map[string]string{"error": "endpoint not found"})
	}
}
func (a api) only(w http.ResponseWriter, r *http.Request, m string, fn func()) {
	if r.Method != m {
		methodNA(w)
		return
	}
	fn()
}

func lineCount(v string) int {
	v = strings.TrimSpace(v)
	if v == "" {
		return 0
	}
	return len(strings.Split(v, "\n"))
}
func containerFor(id string) string {
	if id == "minecraft-production" {
		return env("CRAKNODE_SERVER_CONTAINER", "crakhost-minecraft-production")
	}
	return "crakhost-" + id
}
func (a api) create(w http.ResponseWriter, r *http.Request, id, container string) {
	var b createBody
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 32<<10)).Decode(&b) != nil {
		jsonOut(w, 400, map[string]string{"error": "invalid request"})
		return
	}
	allowed := map[string]bool{"itzg/minecraft-server:latest": true}
	if !allowed[b.Image] {
		jsonOut(w, 400, map[string]string{"error": "image is not allowed by this node"})
		return
	}
	if b.MemoryMB < 512 || b.MemoryMB > 32768 || b.CPU < .25 || b.CPU > 16 || b.HostPort < 1024 || b.HostPort > 65535 {
		jsonOut(w, 400, map[string]string{"error": "invalid resource limits"})
		return
	}
	if b.ContainerPort == 0 {
		b.ContainerPort = 25565
	}
	if _, e := docker("inspect", container); e == nil {
		jsonOut(w, 409, map[string]string{"error": "container already exists"})
		return
	}
	args := []string{"run", "-d", "--name", container, "--restart", "unless-stopped", "--memory", fmt.Sprintf("%dm", b.MemoryMB), "--cpus", fmt.Sprintf("%.2f", b.CPU), "--dns", env("CRAKNODE_DNS_PRIMARY", "1.1.1.1"), "--dns", env("CRAKNODE_DNS_SECONDARY", "8.8.8.8"), "-p", fmt.Sprintf("%d:%d", b.HostPort, b.ContainerPort), "-v", "crakhost_data_" + id + ":/data", "--label", "crakhost.managed=true", "--label", "crakhost.server=" + id}
	for k, v := range b.Env {
		if regexp.MustCompile(`^[A-Z0-9_]{1,64}$`).MatchString(k) && len(v) <= 512 {
			args = append(args, "-e", k+"="+v)
		}
	}
	args = append(args, b.Image)
	out, e := docker(args...)
	if e != nil {
		jsonOut(w, 502, map[string]string{"error": cleanErr(out, e)})
		return
	}
	jsonOut(w, 201, map[string]any{"ok": true, "container": container, "id": strings.TrimSpace(out)})
}

func (a api) deleteServer(w http.ResponseWriter, container string) {
	out, e := docker("rm", "-f", container)
	if e != nil {
		if strings.Contains(strings.ToLower(out), "no such container") {
			jsonOut(w, 200, map[string]any{"ok": true, "alreadyMissing": true})
			return
		}
		jsonOut(w, 502, map[string]string{"error": cleanErr(out, e)})
		return
	}
	jsonOut(w, 200, map[string]any{"ok": true})
}

func (a api) action(w http.ResponseWriter, r *http.Request, container string) {
	var b actionBody
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 8<<10)).Decode(&b) != nil {
		jsonOut(w, 400, map[string]string{"error": "invalid request"})
		return
	}
	var args []string
	switch b.Action {
	case "start":
		args = []string{"start", container}
	case "stop":
		args = []string{"stop", "--time", "15", container}
	case "restart":
		args = []string{"restart", "--time", "15", container}
	case "kill":
		args = []string{"kill", container}
	default:
		jsonOut(w, 400, map[string]string{"error": "unsupported action"})
		return
	}
	out, e := docker(args...)
	if e != nil {
		jsonOut(w, 502, map[string]string{"error": cleanErr(out, e)})
		return
	}
	jsonOut(w, 200, map[string]any{"ok": true, "action": b.Action})
}
func (a api) command(w http.ResponseWriter, r *http.Request, container string) {
	var b commandBody
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 8<<10)).Decode(&b) != nil || strings.TrimSpace(b.Command) == "" || len(b.Command) > 300 {
		jsonOut(w, 400, map[string]string{"error": "invalid command"})
		return
	}
	state, _ := docker("inspect", "-f", "{{.State.Running}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}", container)
	if !strings.HasPrefix(strings.TrimSpace(state), "true|") {
		jsonOut(w, 409, map[string]string{"error": "server is not running"})
		return
	}
	cmd := strings.TrimSpace(b.Command)
	var out string
	var e error
	for attempt := 0; attempt < 3; attempt++ {
		out, e = docker("exec", container, "rcon-cli", cmd)
		if e == nil {
			jsonOut(w, 200, map[string]any{"ok": true, "output": strings.TrimSpace(stripANSI(out))})
			return
		}
		if attempt < 2 {
			time.Sleep(1500 * time.Millisecond)
		}
	}
	jsonOut(w, 503, map[string]string{"error": "Minecraft console is not ready yet. Wait for the server to finish starting, then retry. RCON: " + cleanErr(out, e)})
}
func (a api) status(w http.ResponseWriter, container string) {
	state, e := docker("inspect", "-f", "{{.State.Status}}|{{.State.StartedAt}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}", container)
	if e != nil {
		jsonOut(w, 200, serverStatus{Status: "offline", MemoryLimit: 8192, Uptime: "-"})
		return
	}
	p := strings.Split(strings.TrimSpace(state), "|")
	status := p[0]
	uptime := "-"
	health := "none"
	if len(p) > 2 {
		health = p[2]
	}
	if len(p) > 1 && status == "running" {
		if t, er := time.Parse(time.RFC3339Nano, p[1]); er == nil {
			uptime = humanDuration(time.Since(t))
		}
	}
	s := serverStatus{Status: status, MemoryLimit: 8192, Uptime: uptime, Health: health}
	if status == "running" {
		if raw, er := docker("stats", "--no-stream", "--format", "{{.CPUPerc}}|{{.MemUsage}}", container); er == nil {
			parseStats(raw, &s)
			s.CPURaw = s.CPU
			s.CPULimit = containerCPULimit(container)
			if s.CPULimit > 0 {
				s.CPU = s.CPU / s.CPULimit
			}
			if s.CPU < 0 {
				s.CPU = 0
			}
			if s.CPU > 100 {
				s.CPU = 100
			}
		}
	}
	jsonOut(w, 200, s)
}
func (a api) logs(w http.ResponseWriter, container string) {
	out, e := docker("logs", "--tail", "120", container)
	if e != nil {
		jsonOut(w, 200, map[string]any{"lines": []string{"[CrakNode] Container is not running or has not been created yet."}})
		return
	}
	jsonOut(w, 200, map[string]any{"lines": strings.Split(strings.TrimSpace(stripANSI(out)), "\n")})
}
func cleanPath(v string) (string, error) {
	v = strings.ReplaceAll(v, "\\", "/")
	if v == "" {
		v = "/"
	}
	c := path.Clean("/" + strings.TrimPrefix(v, "/"))
	if strings.Contains(c, "..") || len(c) > 512 {
		return "", fmt.Errorf("invalid path")
	}
	return c, nil
}
func (a api) files(w http.ResponseWriter, r *http.Request, container string) {
	switch r.Method {
	case http.MethodGet:
		p, e := cleanPath(r.URL.Query().Get("path"))
		if e != nil {
			jsonOut(w, 400, map[string]string{"error": e.Error()})
			return
		}
		mode := r.URL.Query().Get("mode")
		if mode == "read" {
			out, er := docker("exec", container, "sh", "-lc", "cat -- "+shellQuote("/data"+p))
			if er != nil {
				jsonOut(w, 502, map[string]string{"error": cleanErr(out, er)})
				return
			}
			if len(out) > 2<<20 {
				jsonOut(w, 413, map[string]string{"error": "file is larger than 2 MB editor limit"})
				return
			}
			jsonOut(w, 200, map[string]any{"path": p, "content": out})
			return
		}
		script := `find "$1" -mindepth 1 -maxdepth 1 -printf '%f|%y|%s|%TY-%Tm-%Td %TH:%TM\n' 2>/dev/null | sort`
		out, er := docker("exec", container, "sh", "-c", script, "sh", "/data"+p)
		if er != nil {
			jsonOut(w, 502, map[string]string{"error": cleanErr(out, er)})
			return
		}
		items := []fileItem{}
		for _, line := range strings.Split(strings.TrimSpace(out), "\n") {
			if line == "" {
				continue
			}
			x := strings.SplitN(line, "|", 4)
			if len(x) < 4 {
				continue
			}
			size, _ := strconv.ParseInt(x[2], 10, 64)
			typ := "file"
			if x[1] == "d" {
				typ = "directory"
			}
			child := path.Join(p, x[0])
			items = append(items, fileItem{Name: x[0], Path: child, Type: typ, Size: size, Modified: x[3]})
		}
		jsonOut(w, 200, map[string]any{"path": p, "items": items})
	case http.MethodPut:
		var b fileBody
		if json.NewDecoder(http.MaxBytesReader(w, r.Body, 3<<20)).Decode(&b) != nil || len(b.Content) > 2<<20 {
			jsonOut(w, 400, map[string]string{"error": "invalid file"})
			return
		}
		p, e := cleanPath(b.Path)
		if e != nil || p == "/" {
			jsonOut(w, 400, map[string]string{"error": "invalid path"})
			return
		}
		cmd := exec.Command("docker", "exec", "-i", container, "sh", "-c", "mkdir -p -- \"$(dirname \"$1\")\" && cat > \"$1\"", "sh", "/data"+p)
		cmd.Stdin = strings.NewReader(b.Content)
		raw, er := cmd.CombinedOutput()
		if er != nil {
			jsonOut(w, 502, map[string]string{"error": cleanErr(string(raw), er)})
			return
		}
		jsonOut(w, 200, map[string]any{"ok": true, "path": p})
	case http.MethodPost:
		var b fileBody
		if json.NewDecoder(http.MaxBytesReader(w, r.Body, 8<<10)).Decode(&b) != nil {
			jsonOut(w, 400, map[string]string{"error": "invalid request"})
			return
		}
		p, e := cleanPath(b.Path)
		if e != nil || p == "/" {
			jsonOut(w, 400, map[string]string{"error": "invalid path"})
			return
		}
		var out string
		var er error
		if b.Kind == "directory" {
			out, er = docker("exec", container, "mkdir", "-p", "/data"+p)
		} else {
			out, er = docker("exec", container, "touch", "/data"+p)
		}
		if er != nil {
			jsonOut(w, 502, map[string]string{"error": cleanErr(out, er)})
			return
		}
		jsonOut(w, 201, map[string]any{"ok": true, "path": p})
	case http.MethodDelete:
		p, e := cleanPath(r.URL.Query().Get("path"))
		if e != nil || p == "/" {
			jsonOut(w, 400, map[string]string{"error": "invalid path"})
			return
		}
		out, er := docker("exec", container, "rm", "-rf", "--", "/data"+p)
		if er != nil {
			jsonOut(w, 502, map[string]string{"error": cleanErr(out, er)})
			return
		}
		jsonOut(w, 200, map[string]any{"ok": true})
	default:
		methodNA(w)
	}
}
func shellQuote(s string) string { return "'" + strings.ReplaceAll(s, "'", "'\\''") + "'" }
func (a api) backup(w http.ResponseWriter, r *http.Request, id, container string) {
	var b struct {
		BackupID string `json:"backupId"`
	}
	_ = json.NewDecoder(http.MaxBytesReader(w, r.Body, 8<<10)).Decode(&b)
	if !safeID.MatchString(strings.ReplaceAll(b.BackupID, "-", "")) && b.BackupID != "" {
		jsonOut(w, 400, map[string]string{"error": "invalid backup id"})
		return
	}
	name := b.BackupID
	if name == "" {
		name = strconv.FormatInt(time.Now().Unix(), 10)
	}
	dir := env("CRAKNODE_BACKUP_DIR", "/tmp/crakhost-backups")
	dest := path.Join(dir, id+"-"+name+".tar.gz")
	pr, pw := io.Pipe()
	cmd := exec.Command("docker", "exec", container, "tar", "-C", "/data", "-cf", "-", ".")
	cmd.Stdout = pw
	cmd.Stderr = os.Stderr
	if e := cmd.Start(); e != nil {
		jsonOut(w, 502, map[string]string{"error": e.Error()})
		return
	}
	f, e := os.Create(dest)
	if e != nil {
		jsonOut(w, 500, map[string]string{"error": e.Error()})
		return
	}
	gz := gzip.NewWriter(f)
	_, copyErr := io.Copy(gz, pr)
	_ = gz.Close()
	_ = f.Close()
	_ = cmd.Wait()
	_ = pw.Close()
	if copyErr != nil {
		jsonOut(w, 500, map[string]string{"error": copyErr.Error()})
		return
	}
	st, _ := os.Stat(dest)
	var size int64
	if st != nil {
		size = st.Size()
	}
	jsonOut(w, 201, map[string]any{"ok": true, "path": dest, "size": size})
}
func (a api) restore(w http.ResponseWriter, r *http.Request, id, container string) {
	var b struct {
		Path string `json:"path"`
	}
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 16<<10)).Decode(&b) != nil || b.Path == "" {
		jsonOut(w, 400, map[string]string{"error": "invalid restore request"})
		return
	}
	dir := env("CRAKNODE_BACKUP_DIR", "/tmp/crakhost-backups")
	cleanDir := path.Clean(dir)
	cleanFile := path.Clean(b.Path)
	if !strings.HasPrefix(cleanFile, cleanDir+"/") || !strings.HasPrefix(path.Base(cleanFile), id+"-") || !strings.HasSuffix(cleanFile, ".tar.gz") {
		jsonOut(w, 400, map[string]string{"error": "backup path is outside managed backup directory"})
		return
	}
	if _, e := os.Stat(cleanFile); e != nil {
		jsonOut(w, 404, map[string]string{"error": "backup file not found"})
		return
	}
	_, _ = docker("stop", "--time", "15", container)
	if out, e := docker("run", "--rm", "-v", "crakhost_data_"+id+":/data", "alpine:3.20", "sh", "-c", "rm -rf /data/* /data/.[!.]* /data/..?* 2>/dev/null || true"); e != nil {
		jsonOut(w, 502, map[string]string{"error": cleanErr(out, e)})
		return
	}
	f, e := os.Open(cleanFile)
	if e != nil {
		jsonOut(w, 500, map[string]string{"error": e.Error()})
		return
	}
	defer f.Close()
	gz, e := gzip.NewReader(f)
	if e != nil {
		jsonOut(w, 400, map[string]string{"error": "invalid backup archive"})
		return
	}
	defer gz.Close()
	cmd := exec.Command("docker", "run", "--rm", "-i", "-v", "crakhost_data_"+id+":/data", "alpine:3.20", "tar", "-C", "/data", "-xf", "-")
	cmd.Stdin = gz
	raw, e := cmd.CombinedOutput()
	if e != nil {
		jsonOut(w, 502, map[string]string{"error": cleanErr(string(raw), e)})
		return
	}
	_, _ = docker("start", container)
	jsonOut(w, 200, map[string]any{"ok": true})
}

func containerCPULimit(container string) float64 {
	raw, e := docker("inspect", "-f", "{{.HostConfig.NanoCpus}}|{{.HostConfig.CpuQuota}}|{{.HostConfig.CpuPeriod}}", container)
	if e != nil {
		return 0
	}
	p := strings.Split(strings.TrimSpace(raw), "|")
	if len(p) > 0 {
		nano, _ := strconv.ParseFloat(p[0], 64)
		if nano > 0 {
			return nano / 1e9
		}
	}
	if len(p) > 2 {
		quota, _ := strconv.ParseFloat(p[1], 64)
		period, _ := strconv.ParseFloat(p[2], 64)
		if quota > 0 && period > 0 {
			return quota / period
		}
	}
	return 0
}

var ansiRE = regexp.MustCompile(`\x1b\[[0-9;?]*[ -/]*[@-~]`)

func stripANSI(s string) string {
	s = ansiRE.ReplaceAllString(s, "")
	s = strings.ReplaceAll(s, "\r", "")
	return strings.Map(func(r rune) rune {
		if r == '\n' || r == '\t' || r >= 32 {
			return r
		}
		return -1
	}, s)
}

func parseStats(raw string, s *serverStatus) {
	p := strings.Split(strings.TrimSpace(raw), "|")
	if len(p) > 0 {
		s.CPU = parsePercent(p[0])
	}
	if len(p) > 1 {
		m := strings.Split(p[1], "/")
		if len(m) > 0 {
			s.Memory = parseMemMB(m[0])
		}
		if len(m) > 1 {
			s.MemoryLimit = parseMemMB(m[1])
		}
	}
}
func parsePercent(v string) float64 {
	f, _ := strconv.ParseFloat(strings.TrimSpace(strings.TrimSuffix(v, "%")), 64)
	return f
}
func parseMemMB(v string) float64 {
	v = strings.TrimSpace(v)
	fields := strings.Fields(v)
	if len(fields) == 0 {
		return 0
	}
	re := regexp.MustCompile(`^([0-9.]+)([A-Za-z]+)$`)
	m := re.FindStringSubmatch(fields[0])
	if len(m) != 3 {
		return 0
	}
	n, _ := strconv.ParseFloat(m[1], 64)
	switch strings.ToLower(m[2]) {
	case "gib", "gb":
		return n * 1024
	case "mib", "mb":
		return n
	case "kib", "kb":
		return n / 1024
	}
	return n
}
func docker(args ...string) (string, error) {
	b, e := exec.Command("docker", args...).CombinedOutput()
	return string(b), e
}
func cleanErr(out string, e error) string {
	s := strings.TrimSpace(out)
	if s != "" {
		if len(s) > 400 {
			s = s[:400]
		}
		return s
	}
	return e.Error()
}
func humanDuration(d time.Duration) string {
	d = d.Round(time.Minute)
	days := int(d.Hours()) / 24
	hours := int(d.Hours()) % 24
	mins := int(d.Minutes()) % 60
	if days > 0 {
		return fmt.Sprintf("%dd %dh %dm", days, hours, mins)
	}
	return fmt.Sprintf("%dh %dm", hours, mins)
}
func env(k, d string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return d
}
func jsonOut(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
func methodNA(w http.ResponseWriter) {
	jsonOut(w, 405, map[string]string{"error": "method not allowed"})
}
