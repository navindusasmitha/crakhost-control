package main

import(
 "fmt"
 "io"
 "log"
 "net/http"
 "os"
 "os/exec"
 "path"
 "strconv"
 "strings"
 "time"
)

const transferVersion="0.25.0"

func init(){
 mux:=http.NewServeMux()
 mux.HandleFunc("/health",transferAuth(func(w http.ResponseWriter,r *http.Request){jsonOut(w,200,map[string]any{"name":"CrakNode Transfer","version":transferVersion,"status":"online","maxUploadMb":transferLimit()>>20})}))
 mux.HandleFunc("/v1/servers/",transferAuth(transferRouter))
 addr:=env("CRAKNODE_TRANSFER_LISTEN",":8089")
 srv:=&http.Server{Addr:addr,Handler:mux,ReadHeaderTimeout:10*time.Second,IdleTimeout:60*time.Second}
 go func(){log.Printf("CrakNode transfer v%s listening on %s",transferVersion,addr);if e:=srv.ListenAndServe();e!=nil&&e!=http.ErrServerClosed{log.Printf("CrakNode transfer fatal: %v",e);os.Exit(1)}}()
}

func transferAuth(next http.HandlerFunc)http.HandlerFunc{return func(w http.ResponseWriter,r *http.Request){token:=os.Getenv("CRAKNODE_TOKEN");if token==""{jsonOut(w,503,map[string]string{"error":"CRAKNODE_TOKEN is not configured"});return};if r.Header.Get("Authorization")!="Bearer "+token{jsonOut(w,401,map[string]string{"error":"unauthorized"});return};next(w,r)}}
func transferRouter(w http.ResponseWriter,r *http.Request){p:=strings.TrimPrefix(r.URL.Path,"/v1/servers/");parts:=strings.Split(p,"/");if len(parts)<2||!safeID.MatchString(parts[0]){jsonOut(w,404,map[string]string{"error":"invalid server identifier"});return};id,op:=parts[0],parts[1];container:=containerFor(id);switch op{case "file-upload":binaryUpload(w,r,container);case "file-download":binaryDownload(w,r,container);case "backup-download":backupDownload(w,r,id);default:jsonOut(w,404,map[string]string{"error":"transfer endpoint not found"})}}
func transferLimit()int64{mb:=int64(512);if v,e:=strconv.ParseInt(env("CRAKNODE_TRANSFER_MAX_MB","512"),10,64);e==nil&&v>0&&v<=4096{mb=v};return mb<<20}
func binaryUpload(w http.ResponseWriter,r *http.Request,container string){if r.Method!=http.MethodPut{methodNA(w);return};p,e:=cleanPath(r.URL.Query().Get("path"));if e!=nil||p=="/"{jsonOut(w,400,map[string]string{"error":"invalid path"});return};max:=transferLimit();if r.ContentLength>max{jsonOut(w,413,map[string]string{"error":"file exceeds transfer limit"});return};r.Body=http.MaxBytesReader(w,r.Body,max);cmd:=exec.Command("docker","exec","-i",container,"sh","-c","mkdir -p -- \"$(dirname \"$1\")\" && cat > \"$1\"","sh","/data"+p);stdin,e:=cmd.StdinPipe();if e!=nil{jsonOut(w,500,map[string]string{"error":e.Error()});return};var stderr strings.Builder;cmd.Stderr=&stderr;if e=cmd.Start();e!=nil{jsonOut(w,502,map[string]string{"error":e.Error()});return};n,copyErr:=io.Copy(stdin,r.Body);_ = stdin.Close();waitErr:=cmd.Wait();if copyErr!=nil||waitErr!=nil{msg:=strings.TrimSpace(stderr.String());if msg==""{if copyErr!=nil{msg=copyErr.Error()}else{msg=waitErr.Error()}};jsonOut(w,502,map[string]string{"error":msg});return};jsonOut(w,200,map[string]any{"ok":true,"path":p,"size":n})}
func binaryDownload(w http.ResponseWriter,r *http.Request,container string){if r.Method!=http.MethodGet{methodNA(w);return};p,e:=cleanPath(r.URL.Query().Get("path"));if e!=nil||p=="/"{jsonOut(w,400,map[string]string{"error":"invalid path"});return};sizeRaw,e:=docker("exec",container,"stat","-c","%s","/data"+p);if e!=nil{jsonOut(w,404,map[string]string{"error":"file not found"});return};size,_:=strconv.ParseInt(strings.TrimSpace(sizeRaw),10,64);w.Header().Set("Content-Type","application/octet-stream");w.Header().Set("Content-Disposition",fmt.Sprintf("attachment; filename=%q",path.Base(p)));if size>=0{w.Header().Set("Content-Length",strconv.FormatInt(size,10))};cmd:=exec.Command("docker","exec",container,"cat","--","/data"+p);cmd.Stdout=w;cmd.Stderr=os.Stderr;if e:=cmd.Run();e!=nil{return}}
func backupDownload(w http.ResponseWriter,r *http.Request,id string){if r.Method!=http.MethodGet{methodNA(w);return};name:=r.URL.Query().Get("name");if name==""||strings.ContainsAny(name,"/\\")||!strings.HasPrefix(name,id+"-")||!strings.HasSuffix(name,".tar.gz"){jsonOut(w,400,map[string]string{"error":"invalid backup name"});return};dir:=path.Clean(env("CRAKNODE_BACKUP_DIR","/tmp/crakhost-backups"));file:=path.Join(dir,path.Base(name));if !strings.HasPrefix(file,dir+"/"){jsonOut(w,400,map[string]string{"error":"invalid backup path"});return};f,e:=os.Open(file);if e!=nil{jsonOut(w,404,map[string]string{"error":"backup not found"});return};defer f.Close();st,_:=f.Stat();w.Header().Set("Content-Type","application/gzip");w.Header().Set("Content-Disposition",fmt.Sprintf("attachment; filename=%q",path.Base(file)));if st!=nil{w.Header().Set("Content-Length",strconv.FormatInt(st.Size(),10))};_,_=io.Copy(w,f)}
