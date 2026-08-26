package main

import (
    "encoding/json"
    "fmt"
    "log"
    "net/http"
    "os"
    "os/exec"
    "regexp"
    "strconv"
    "strings"
    "time"
)

const version = "0.59.0"

var safeID = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$`)
var safeEnvKey = regexp.MustCompile(`^[A-Z0-9_]{1,64}$`)

type api struct{ token string }
type actionBody struct { Action string `json:"action"` }
type commandBody struct { Command string `json:"command"` }
type createBody struct {
    Image string `json:"image"`
    MemoryMB int `json:"memoryMb"`
    CPU float64 `json:"cpu"`
    HostPort int `json:"hostPort"`
    ContainerPort int `json:"containerPort"`
    Env map[string]string `json:"env"`
}
type serverStatus struct {
    Status string `json:"status"`
    CPU float64 `json:"cpu"`
    CPURaw float64 `json:"cpuRaw,omitempty"`
    CPULimit float64 `json:"cpuLimit,omitempty"`
    Memory float64 `json:"memory"`
    MemoryLimit float64 `json:"memoryLimit"`
    Uptime string `json:"uptime"`
    Health string `json:"health,omitempty"`
    ExitCode int `json:"exitCode"`
    OOMKilled bool `json:"oomKilled"`
    StateError string `json:"stateError,omitempty"`
    RestartCount int `json:"restartCount"`
    StartedAt string `json:"startedAt,omitempty"`
    FinishedAt string `json:"finishedAt,omitempty"`
    Image string `json:"image,omitempty"`
    ContainerID string `json:"containerId,omitempty"`
    RuntimeNetwork string `json:"runtimeNetwork,omitempty"`
}

func main() {
    token := strings.TrimSpace(os.Getenv("CRAKNODE_TOKEN"))
    if token == "" {
        log.Fatal("CRAKNODE_TOKEN is required")
    }
    a := api{token: token}
    _ = os.MkdirAll(env("CRAKNODE_BACKUP_DIR", "/tmp/crakhost-backups"), 0750)

    mux := http.NewServeMux()
    mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
        if r.Method != http.MethodGet { methodNA(w); return }
        jsonOut(w, 200, map[string]any{"name":"CrakNode","version":version,"status":"online","time":time.Now().UTC()})
    })
    mux.HandleFunc("/diagnostics", a.auth(func(w http.ResponseWriter, r *http.Request) {
        if r.Method != http.MethodGet { methodNA(w); return }
        dockerVersion, dockerErr := docker("version", "--format", "{{.Server.Version}}")
        managedRaw, _ := docker("ps", "-a", "--filter", "label=crakhost.managed=true", "--format", "{{.ID}}")
        runningRaw, _ := docker("ps", "--filter", "label=crakhost.managed=true", "--format", "{{.ID}}")
        pressure := readHostPressure()
        out := map[string]any{
            "name":"CrakNode",
            "version":version,
            "status":"online",
            "managedContainers":lineCount(managedRaw),
            "runningContainers":lineCount(runningRaw),
            "hostCpus":pressure.CPUs,
            "load1":pressure.Load1,
            "memoryTotalMb":pressure.MemoryTotalMB,
            "memoryAvailableMb":pressure.MemoryAvailableMB,
            "memoryUsedPct":pressure.MemoryUsedPct,
            "pressureLevel":pressure.Level,
            "databaseContainer":databaseContainer(),
            "time":time.Now().UTC(),
        }
        if dockerErr == nil { out["dockerVersion"] = strings.TrimSpace(dockerVersion) } else { out["dockerError"] = cleanErr(dockerVersion,dockerErr) }
        diskPath := env("CRAKNODE_CAPACITY_PATH", env("CRAKNODE_BACKUP_DIR", "/backups"))
        if d, err := readDiskTelemetry(diskPath); err == nil {
            out["diskPath"] = d.Path
            out["diskTotalBytes"] = d.TotalBytes
            out["diskFreeBytes"] = d.FreeBytes
        } else {
            out["diskError"] = err.Error()
        }
        jsonOut(w, 200, out)
    }))
    mux.HandleFunc("/v1/servers/", a.auth(a.serverRouter))

    addr := env("CRAKNODE_LISTEN", ":8088")
    log.Printf("CrakNode v%s listening on %s", version, addr)
    srv := &http.Server{Addr:addr,Handler:mux,ReadHeaderTimeout:10*time.Second,IdleTimeout:60*time.Second}
    log.Fatal(srv.ListenAndServe())
}

func (a api) auth(next http.HandlerFunc) http.HandlerFunc {
    return func(w http.ResponseWriter, r *http.Request) {
        if r.Header.Get("Authorization") != "Bearer "+a.token {
            jsonOut(w, 401, map[string]string{"error":"unauthorized"})
            return
        }
        next(w, r)
    }
}

func (a api) serverRouter(w http.ResponseWriter, r *http.Request) {
    p := strings.TrimPrefix(r.URL.Path, "/v1/servers/")
    parts := strings.Split(p, "/")
    if len(parts) < 2 || !safeID.MatchString(parts[0]) {
        jsonOut(w, 404, map[string]string{"error":"invalid server identifier"})
        return
    }
    id, op := parts[0], parts[1]
    container := containerFor(id)
    switch op {
    case "status": a.only(w,r,http.MethodGet,func(){a.status(w,container)})
    case "logs": a.only(w,r,http.MethodGet,func(){a.logs(w,container)})
    case "action": a.only(w,r,http.MethodPost,func(){a.action(w,r,id,container)})
    case "command": a.only(w,r,http.MethodPost,func(){a.command(w,r,container)})
    case "create": a.only(w,r,http.MethodPost,func(){a.create(w,r,id,container)})
    case "files": a.files(w,r,container)
    case "backup": a.only(w,r,http.MethodPost,func(){a.backup(w,r,id,container)})
    case "restore": a.only(w,r,http.MethodPost,func(){a.restore(w,r,id,container)})
    case "delete": a.only(w,r,http.MethodPost,func(){a.deleteServer(w,id,container)})
    default: jsonOut(w,404,map[string]string{"error":"endpoint not found"})
    }
}

func (a api) only(w http.ResponseWriter, r *http.Request, method string, fn func()) {
    if r.Method != method { methodNA(w); return }
    fn()
}

func lineCount(v string) int {
    v = strings.TrimSpace(v)
    if v == "" { return 0 }
    return len(strings.Split(v,"\n"))
}

func containerFor(id string) string { return "crakhost-" + id }
func serverNetwork(id string) string { return "crakhost-net-" + id }

func databaseContainer() string {
    if explicit:=strings.TrimSpace(os.Getenv("CRAKNODE_DATABASE_CONTAINER"));explicit!="" { return explicit }
    project:=env("CRAKNODE_DATABASE_PROJECT","crakhost-control")
    raw,err:=docker("ps","--filter","label=com.docker.compose.project="+project,"--filter","label=com.docker.compose.service=postgres","--format","{{.ID}}")
    if err!=nil{return ""}
    lines:=strings.Fields(raw);if len(lines)==0{return ""};return lines[0]
}

func networkHasContainer(network, container string) bool {
    if network==""||container==""{return false}
    raw,err:=docker("inspect","-f","{{range $k,$v := .NetworkSettings.Networks}}{{$k}} {{end}}",container)
    if err!=nil{return false}
    for _,name:=range strings.Fields(raw){if name==network{return true}}
    return false
}

func ensureRuntimeNetwork(id, container string) string {
    network:=serverNetwork(id)
    if _,err:=docker("network","inspect",network);err!=nil {
        _,_=docker("network","create","--label","crakhost.managed=true","--label","crakhost.server="+id,network)
    }
    if dbContainer:=databaseContainer();dbContainer!=""&&!networkHasContainer(network,dbContainer) {
        _,_=docker("network","connect","--alias","postgres",network,dbContainer)
    }
    if container!="" {
        if _,err:=docker("inspect",container);err==nil&&!networkHasContainer(network,container) {
            _,_=docker("network","connect",network,container)
        }
    }
    return network
}

func cleanupRuntimeNetwork(id string) {
    network:=serverNetwork(id)
    if dbContainer:=databaseContainer();dbContainer!="" { _,_=docker("network","disconnect","-f",network,dbContainer) }
    _,_=docker("network","rm",network)
}

func (a api) create(w http.ResponseWriter, r *http.Request, id, container string) {
    var b createBody
    if json.NewDecoder(http.MaxBytesReader(w,r.Body,32<<10)).Decode(&b) != nil {
        jsonOut(w,400,map[string]string{"error":"invalid request"});return
    }
    b.Image = strings.TrimSpace(b.Image)
    if !allowedRuntimeImage(b.Image) {
        jsonOut(w,400,map[string]string{"error":"image is not allowed by CRAKNODE_ALLOWED_IMAGES"});return
    }
    if b.MemoryMB < 512 || b.MemoryMB > maxServerMemoryMB() || b.CPU < .25 || b.CPU > maxServerCPU() || b.HostPort < 1024 || b.HostPort > 65535 {
        jsonOut(w,400,map[string]string{"error":"invalid resource limits"});return
    }
    if b.ContainerPort == 0 { b.ContainerPort = 25565 }
    if b.ContainerPort < 1 || b.ContainerPort > 65535 {
        jsonOut(w,400,map[string]string{"error":"invalid container port"});return
    }
    if _, err := docker("inspect",container); err == nil {
        jsonOut(w,409,map[string]string{"error":"container already exists"});return
    }
    network:=ensureRuntimeNetwork(id,"")
    args := []string{"run","-d","--name",container,"--restart","unless-stopped","--network",network,"--memory",fmt.Sprintf("%dm",b.MemoryMB),"--cpus",fmt.Sprintf("%.2f",b.CPU),"--dns",env("CRAKNODE_DNS_PRIMARY","1.1.1.1"),"--dns",env("CRAKNODE_DNS_SECONDARY","8.8.8.8"),"-p",fmt.Sprintf("%d:%d",b.HostPort,b.ContainerPort),"-v","crakhost_data_"+id+":/data","--label","crakhost.managed=true","--label","crakhost.server="+id}
    for k,v := range b.Env {
        if safeEnvKey.MatchString(k) && len(v) <= 512 { args=append(args,"-e",k+"="+v) }
    }
    args=append(args,b.Image)
    out,err:=docker(args...)
    if err!=nil { cleanupRuntimeNetwork(id);jsonOut(w,502,map[string]string{"error":cleanErr(out,err)});return }
    jsonOut(w,201,map[string]any{"ok":true,"container":container,"id":strings.TrimSpace(out),"network":network,"databaseHost":"postgres"})
}

func (a api) deleteServer(w http.ResponseWriter, id, container string) {
    out,err:=docker("rm","-f",container)
    if err!=nil {
        if strings.Contains(strings.ToLower(out),"no such container") { cleanupRuntimeNetwork(id);jsonOut(w,200,map[string]any{"ok":true,"alreadyMissing":true});return }
        jsonOut(w,502,map[string]string{"error":cleanErr(out,err)});return
    }
    cleanupRuntimeNetwork(id)
    jsonOut(w,200,map[string]any{"ok":true})
}

func (a api) action(w http.ResponseWriter, r *http.Request, id, container string) {
    var b actionBody
    if json.NewDecoder(http.MaxBytesReader(w,r.Body,8<<10)).Decode(&b)!=nil { jsonOut(w,400,map[string]string{"error":"invalid request"});return }
    var out string;var err error
    switch b.Action {
    case "start":
        ensureRuntimeNetwork(id,container)
        out,err=docker("start",container)
        if err==nil { ensureRuntimeNetwork(id,container) }
    case "stop": out,err=docker("stop","--time","15",container)
    case "restart":
        ensureRuntimeNetwork(id,container)
        out,err=docker("restart","--time","15",container)
        if err==nil { ensureRuntimeNetwork(id,container) }
    case "kill": out,err=docker("kill",container)
    default: jsonOut(w,400,map[string]string{"error":"unsupported action"});return
    }
    if err!=nil { jsonOut(w,502,map[string]string{"error":cleanErr(out,err)});return }
    jsonOut(w,200,map[string]any{"ok":true,"action":b.Action,"network":serverNetwork(id)})
}

func (a api) command(w http.ResponseWriter, r *http.Request, container string) {
    var b commandBody
    if json.NewDecoder(http.MaxBytesReader(w,r.Body,8<<10)).Decode(&b)!=nil || strings.TrimSpace(b.Command)=="" || len(b.Command)>300 { jsonOut(w,400,map[string]string{"error":"invalid command"});return }
    state,_:=docker("inspect","-f","{{.State.Running}}",container)
    if strings.TrimSpace(state)!="true" { jsonOut(w,409,map[string]string{"error":"server is not running"});return }
    cmd:=strings.TrimSpace(b.Command);var out string;var err error
    for attempt:=0;attempt<3;attempt++ {
        out,err=docker("exec",container,"rcon-cli",cmd)
        if err==nil { jsonOut(w,200,map[string]any{"ok":true,"output":strings.TrimSpace(stripANSI(out))});return }
        if attempt<2 { time.Sleep(1500*time.Millisecond) }
    }
    jsonOut(w,503,map[string]string{"error":"runtime console adapter is unavailable or not ready: "+cleanErr(out,err)})
}

func (a api) status(w http.ResponseWriter, container string) {
    tpl:="{{.State.Status}}\t{{.State.StartedAt}}\t{{.State.FinishedAt}}\t{{.State.ExitCode}}\t{{.State.OOMKilled}}\t{{.RestartCount}}\t{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}\t{{.Config.Image}}\t{{.Id}}"
    state,err:=docker("inspect","-f",tpl,container)
    if err!=nil { jsonOut(w,200,serverStatus{Status:"offline",Uptime:"-",Health:"none"});return }
    p:=strings.Split(strings.TrimSpace(state),"\t");status:="unknown";uptime:="-";health:="none"
    if len(p)>0 { status=p[0] }
    startedAt:="";finishedAt:="";exitCode:=0;oomKilled:=false;restartCount:=0;image:="";containerID:=""
    if len(p)>1 { startedAt=cleanDockerTime(p[1]) }
    if len(p)>2 { finishedAt=cleanDockerTime(p[2]) }
    if len(p)>3 { exitCode,_=strconv.Atoi(strings.TrimSpace(p[3])) }
    if len(p)>4 { oomKilled,_=strconv.ParseBool(strings.TrimSpace(p[4])) }
    if len(p)>5 { restartCount,_=strconv.Atoi(strings.TrimSpace(p[5])) }
    if len(p)>6 { health=p[6] }
    if len(p)>7 { image=p[7] }
    if len(p)>8 { containerID=p[8] }
    if status=="running"&&startedAt!="" { if t,e:=time.Parse(time.RFC3339Nano,startedAt);e==nil { uptime=humanDuration(time.Since(t)) } }
    stateErrorRaw,_:=docker("inspect","-f","{{.State.Error}}",container)
    inspectLimit:=containerMemoryLimitMB(container)
    s:=serverStatus{Status:status,MemoryLimit:inspectLimit,CPULimit:containerCPULimit(container),Uptime:uptime,Health:health,ExitCode:exitCode,OOMKilled:oomKilled,StateError:strings.TrimSpace(stateErrorRaw),RestartCount:restartCount,StartedAt:startedAt,FinishedAt:finishedAt,Image:image,ContainerID:containerID,RuntimeNetwork:containerNetworks(container)}
    if status=="running" {
        if raw,e:=docker("stats","--no-stream","--format","{{.CPUPerc}}|{{.MemUsage}}",container);e==nil {
            parseStats(raw,&s)
            if s.MemoryLimit<=0 { s.MemoryLimit=inspectLimit }
            s.CPURaw=s.CPU
            if s.CPULimit>0 { s.CPU=s.CPU/s.CPULimit }
            if s.CPU<0 { s.CPU=0 };if s.CPU>100 { s.CPU=100 }
        }
    }
    jsonOut(w,200,s)
}

func (a api) logs(w http.ResponseWriter, container string) {
    out,err:=docker("logs","--tail","120",container)
    if err!=nil { jsonOut(w,200,map[string]any{"lines":[]string{},"available":false});return }
    clean:=strings.TrimSpace(stripANSI(out));lines:=[]string{};if clean!=""{lines=strings.Split(clean,"\n")}
    jsonOut(w,200,map[string]any{"lines":lines,"available":true})
}

func containerNetworks(container string) string {
    raw,err:=docker("inspect","-f","{{range $k,$v := .NetworkSettings.Networks}}{{$k}} {{end}}",container)
    if err!=nil{return ""};return strings.Join(strings.Fields(raw),", ")
}
func cleanDockerTime(v string) string { v=strings.TrimSpace(v);if v==""||strings.HasPrefix(v,"0001-"){return ""};return v }
func containerCPULimit(container string) float64 {
    raw,err:=docker("inspect","-f","{{.HostConfig.NanoCpus}}|{{.HostConfig.CpuQuota}}|{{.HostConfig.CpuPeriod}}",container)
    if err!=nil{return 0};p:=strings.Split(strings.TrimSpace(raw),"|")
    if len(p)>0 { nano,_:=strconv.ParseFloat(p[0],64);if nano>0{return nano/1e9} }
    if len(p)>2 { quota,_:=strconv.ParseFloat(p[1],64);period,_:=strconv.ParseFloat(p[2],64);if quota>0&&period>0{return quota/period} }
    return 0
}

var ansiRE=regexp.MustCompile(`\x1b\[[0-9;?]*[ -/]*[@-~]`)
func stripANSI(s string) string { s=ansiRE.ReplaceAllString(s,"");s=strings.ReplaceAll(s,"\r","");return strings.Map(func(r rune)rune{if r=='\n'||r=='\t'||r>=32{return r};return -1},s) }
func parseStats(raw string,s *serverStatus){p:=strings.Split(strings.TrimSpace(raw),"|");if len(p)>0{s.CPU=parsePercent(p[0])};if len(p)>1{m:=strings.Split(p[1],"/");if len(m)>0{s.Memory=parseMemMB(m[0])};if len(m)>1{s.MemoryLimit=parseMemMB(m[1])}}}
func parsePercent(v string)float64{f,_:=strconv.ParseFloat(strings.TrimSpace(strings.TrimSuffix(v,"%")),64);return f}
func parseMemMB(v string)float64{v=strings.TrimSpace(v);fields:=strings.Fields(v);if len(fields)==0{return 0};re:=regexp.MustCompile(`^([0-9.]+)([A-Za-z]+)$`);m:=re.FindStringSubmatch(fields[0]);if len(m)!=3{return 0};n,_:=strconv.ParseFloat(m[1],64);switch strings.ToLower(m[2]){case "gib","gb":return n*1024;case "mib","mb":return n;case "kib","kb":return n/1024};return n}
func docker(args ...string)(string,error){b,e:=exec.Command("docker",args...).CombinedOutput();return string(b),e}
func cleanErr(out string,e error)string{s:=strings.TrimSpace(out);if s!=""{if len(s)>400{s=s[:400]};return s};if e!=nil{return e.Error()};return "unknown error"}
func humanDuration(d time.Duration)string{d=d.Round(time.Minute);days:=int(d.Hours())/24;hours:=int(d.Hours())%24;mins:=int(d.Minutes())%60;if days>0{return fmt.Sprintf("%dd %dh %dm",days,hours,mins)};return fmt.Sprintf("%dh %dm",hours,mins)}
func env(k,d string)string{if v:=os.Getenv(k);v!=""{return v};return d}
func jsonOut(w http.ResponseWriter,status int,v any){w.Header().Set("Content-Type","application/json");w.Header().Set("Cache-Control","no-store");w.WriteHeader(status);_=json.NewEncoder(w).Encode(v)}
func methodNA(w http.ResponseWriter){jsonOut(w,405,map[string]string{"error":"method not allowed"})}
