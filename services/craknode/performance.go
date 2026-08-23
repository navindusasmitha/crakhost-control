package main

import (
 "bufio"
 "log"
 "math"
 "os"
 "runtime"
 "strconv"
 "strings"
 "time"
)

type hostPressure struct{
 Load1 float64
 MemoryUsedPct float64
 MemoryTotalMB float64
 MemoryAvailableMB float64
 CPUs int
 Level string
}

func init(){go performanceController()}

func readHostPressure() hostPressure {
 p:=hostPressure{CPUs:runtime.NumCPU(),Level:"normal"}
 if b,e:=os.ReadFile("/proc/loadavg");e==nil { f:=strings.Fields(string(b)); if len(f)>0 { p.Load1,_=strconv.ParseFloat(f[0],64) } }
 if f,e:=os.Open("/proc/meminfo");e==nil {
  defer f.Close();var total,avail float64;s:=bufio.NewScanner(f)
  for s.Scan(){x:=strings.Fields(s.Text());if len(x)<2{continue};v,_:=strconv.ParseFloat(x[1],64);switch strings.TrimSuffix(x[0],":"){case "MemTotal":total=v;case "MemAvailable":avail=v}}
  if total>0{p.MemoryTotalMB=total/1024;p.MemoryAvailableMB=avail/1024;p.MemoryUsedPct=(total-avail)*100/total}
 }
 loadPct:=0.0;if p.CPUs>0{loadPct=p.Load1/float64(p.CPUs)*100}
 if p.MemoryUsedPct>=92||loadPct>=110 {p.Level="critical"} else if p.MemoryUsedPct>=82||loadPct>=85 {p.Level="high"}
 return p
}

func performanceController(){
 if strings.EqualFold(env("CRAKNODE_AUTO_PERFORMANCE","true"),"false"){log.Println("auto performance controller disabled");return}
 interval:=15*time.Second;if n,e:=strconv.Atoi(env("CRAKNODE_PERFORMANCE_INTERVAL","15"));e==nil&&n>=5&&n<=300{interval=time.Duration(n)*time.Second}
 log.Printf("auto performance controller enabled interval=%s",interval)
 last:="";tick:=time.NewTicker(interval);defer tick.Stop()
 for range tick.C{p:=readHostPressure();if p.Level!=last{log.Printf("host pressure level=%s load1=%.2f memory=%.1f%%",p.Level,p.Load1,p.MemoryUsedPct);last=p.Level};tuneManagedContainers(p)}
}

func tuneManagedContainers(p hostPressure){
 raw,e:=docker("ps","--filter","label=crakhost.managed=true","--format","{{.Names}}");if e!=nil{return}
 names:=strings.Fields(strings.TrimSpace(raw));if len(names)==0{return}
 factor:=1.0;if p.Level=="high"{factor=.75};if p.Level=="critical"{factor=.5}
 for _,name:=range names{
  limit:=containerCPULimit(name);base:=512.0;if limit>0{base=limit*512}
  weight:=int(math.Round(base*factor));if weight<2{weight=2};if weight>262144{weight=262144}
  _,_ = docker("update","--cpu-shares",strconv.Itoa(weight),name)
 }
}
