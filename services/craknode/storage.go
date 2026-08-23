package main

import (
    "compress/gzip"
    "encoding/json"
    "fmt"
    "io"
    "net/http"
    "os"
    "os/exec"
    "path"
    "strconv"
    "strings"
    "time"
)

type fileBody struct {
    Path    string `json:"path"`
    Content string `json:"content"`
    Kind    string `json:"kind"`
}

type fileItem struct {
    Name     string `json:"name"`
    Path     string `json:"path"`
    Type     string `json:"type"`
    Size     int64  `json:"size"`
    Modified string `json:"modified"`
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
        p, err := cleanPath(r.URL.Query().Get("path"))
        if err != nil {
            jsonOut(w, 400, map[string]string{"error": err.Error()})
            return
        }
        if r.URL.Query().Get("mode") == "read" {
            out, runErr := docker("exec", container, "sh", "-lc", "cat -- "+shellQuote("/data"+p))
            if runErr != nil {
                jsonOut(w, 502, map[string]string{"error": cleanErr(out, runErr)})
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
        out, runErr := docker("exec", container, "sh", "-c", script, "sh", "/data"+p)
        if runErr != nil {
            jsonOut(w, 502, map[string]string{"error": cleanErr(out, runErr)})
            return
        }
        items := []fileItem{}
        for _, line := range strings.Split(strings.TrimSpace(out), "\n") {
            if line == "" { continue }
            x := strings.SplitN(line, "|", 4)
            if len(x) < 4 { continue }
            size, _ := strconv.ParseInt(x[2], 10, 64)
            typ := "file"
            if x[1] == "d" { typ = "directory" }
            items = append(items, fileItem{Name:x[0], Path:path.Join(p,x[0]), Type:typ, Size:size, Modified:x[3]})
        }
        jsonOut(w, 200, map[string]any{"path":p,"items":items})
    case http.MethodPut:
        var b fileBody
        if json.NewDecoder(http.MaxBytesReader(w, r.Body, 3<<20)).Decode(&b) != nil || len(b.Content) > 2<<20 {
            jsonOut(w, 400, map[string]string{"error":"invalid file"})
            return
        }
        p, err := cleanPath(b.Path)
        if err != nil || p == "/" {
            jsonOut(w, 400, map[string]string{"error":"invalid path"})
            return
        }
        cmd := exec.Command("docker", "exec", "-i", container, "sh", "-c", "mkdir -p -- \"$(dirname \"$1\")\" && cat > \"$1\"", "sh", "/data"+p)
        cmd.Stdin = strings.NewReader(b.Content)
        raw, runErr := cmd.CombinedOutput()
        if runErr != nil {
            jsonOut(w, 502, map[string]string{"error":cleanErr(string(raw),runErr)})
            return
        }
        jsonOut(w, 200, map[string]any{"ok":true,"path":p})
    case http.MethodPost:
        var b fileBody
        if json.NewDecoder(http.MaxBytesReader(w, r.Body, 8<<10)).Decode(&b) != nil {
            jsonOut(w, 400, map[string]string{"error":"invalid request"})
            return
        }
        p, err := cleanPath(b.Path)
        if err != nil || p == "/" {
            jsonOut(w, 400, map[string]string{"error":"invalid path"})
            return
        }
        var out string
        var runErr error
        if b.Kind == "directory" { out, runErr = docker("exec",container,"mkdir","-p","/data"+p) } else { out, runErr = docker("exec",container,"touch","/data"+p) }
        if runErr != nil {
            jsonOut(w, 502, map[string]string{"error":cleanErr(out,runErr)})
            return
        }
        jsonOut(w, 201, map[string]any{"ok":true,"path":p})
    case http.MethodDelete:
        p, err := cleanPath(r.URL.Query().Get("path"))
        if err != nil || p == "/" {
            jsonOut(w, 400, map[string]string{"error":"invalid path"})
            return
        }
        out, runErr := docker("exec",container,"rm","-rf","--","/data"+p)
        if runErr != nil {
            jsonOut(w, 502, map[string]string{"error":cleanErr(out,runErr)})
            return
        }
        jsonOut(w, 200, map[string]any{"ok":true})
    default:
        methodNA(w)
    }
}

func shellQuote(s string) string { return "'" + strings.ReplaceAll(s, "'", "'\\''") + "'" }

func (a api) backup(w http.ResponseWriter, r *http.Request, id, container string) {
    var b struct{ BackupID string `json:"backupId"` }
    _ = json.NewDecoder(http.MaxBytesReader(w, r.Body, 8<<10)).Decode(&b)
    if !safeID.MatchString(strings.ReplaceAll(b.BackupID, "-", "")) && b.BackupID != "" {
        jsonOut(w, 400, map[string]string{"error":"invalid backup id"})
        return
    }
    name := b.BackupID
    if name == "" { name = strconv.FormatInt(time.Now().Unix(),10) }
    dir := env("CRAKNODE_BACKUP_DIR", "/tmp/crakhost-backups")
    dest := path.Join(dir,id+"-"+name+".tar.gz")
    pr,pw := io.Pipe()
    cmd := exec.Command("docker","exec",container,"tar","-C","/data","-cf","-",".")
    cmd.Stdout=pw;cmd.Stderr=os.Stderr
    if err:=cmd.Start();err!=nil { jsonOut(w,502,map[string]string{"error":err.Error()});return }
    f,err:=os.Create(dest)
    if err!=nil { jsonOut(w,500,map[string]string{"error":err.Error()});return }
    gz:=gzip.NewWriter(f)
    _,copyErr:=io.Copy(gz,pr)
    _=gz.Close();_=f.Close();_=cmd.Wait();_=pw.Close()
    if copyErr!=nil { jsonOut(w,500,map[string]string{"error":copyErr.Error()});return }
    st,_:=os.Stat(dest);var size int64;if st!=nil{size=st.Size()}
    jsonOut(w,201,map[string]any{"ok":true,"path":dest,"size":size})
}

func (a api) restore(w http.ResponseWriter, r *http.Request, id, container string) {
    var b struct{ Path string `json:"path"` }
    if json.NewDecoder(http.MaxBytesReader(w,r.Body,16<<10)).Decode(&b)!=nil || b.Path=="" { jsonOut(w,400,map[string]string{"error":"invalid restore request"});return }
    dir:=env("CRAKNODE_BACKUP_DIR","/tmp/crakhost-backups");cleanDir:=path.Clean(dir);cleanFile:=path.Clean(b.Path)
    if !strings.HasPrefix(cleanFile,cleanDir+"/") || !strings.HasPrefix(path.Base(cleanFile),id+"-") || !strings.HasSuffix(cleanFile,".tar.gz") { jsonOut(w,400,map[string]string{"error":"backup path is outside managed backup directory"});return }
    if _,err:=os.Stat(cleanFile);err!=nil { jsonOut(w,404,map[string]string{"error":"backup file not found"});return }
    _,_=docker("stop","--time","15",container)
    if out,err:=docker("run","--rm","-v","crakhost_data_"+id+":/data","alpine:3.20","sh","-c","rm -rf /data/* /data/.[!.]* /data/..?* 2>/dev/null || true");err!=nil { jsonOut(w,502,map[string]string{"error":cleanErr(out,err)});return }
    f,err:=os.Open(cleanFile);if err!=nil { jsonOut(w,500,map[string]string{"error":err.Error()});return };defer f.Close()
    gz,err:=gzip.NewReader(f);if err!=nil { jsonOut(w,400,map[string]string{"error":"invalid backup archive"});return };defer gz.Close()
    cmd:=exec.Command("docker","run","--rm","-i","-v","crakhost_data_"+id+":/data","alpine:3.20","tar","-C","/data","-xf","-");cmd.Stdin=gz
    raw,err:=cmd.CombinedOutput();if err!=nil { jsonOut(w,502,map[string]string{"error":cleanErr(string(raw),err)});return }
    _,_=docker("start",container);jsonOut(w,200,map[string]any{"ok":true})
}
