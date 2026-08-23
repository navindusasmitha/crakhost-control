package main

import (
    "fmt"
    "strconv"
    "strings"
    "syscall"
)

type diskTelemetry struct {
    Path       string
    TotalBytes int64
    FreeBytes  int64
}

func readDiskTelemetry(p string) (diskTelemetry, error) {
    if strings.TrimSpace(p) == "" {
        return diskTelemetry{}, fmt.Errorf("capacity path is empty")
    }
    var fs syscall.Statfs_t
    if err := syscall.Statfs(p, &fs); err != nil {
        return diskTelemetry{}, err
    }
    total := int64(fs.Blocks) * int64(fs.Bsize)
    free := int64(fs.Bavail) * int64(fs.Bsize)
    if total <= 0 || free < 0 {
        return diskTelemetry{}, fmt.Errorf("invalid filesystem metrics")
    }
    return diskTelemetry{Path: p, TotalBytes: total, FreeBytes: free}, nil
}

func containerMemoryLimitMB(container string) float64 {
    raw, err := docker("inspect", "-f", "{{.HostConfig.Memory}}", container)
    if err != nil {
        return 0
    }
    b, err := strconv.ParseFloat(strings.TrimSpace(raw), 64)
    if err != nil || b <= 0 {
        return 0
    }
    return b / 1024 / 1024
}

func allowedRuntimeImage(image string) bool {
    image = strings.TrimSpace(image)
    if image == "" {
        return false
    }
    configured := env("CRAKNODE_ALLOWED_IMAGES", "itzg/minecraft-server:latest")
    for _, item := range strings.Split(configured, ",") {
        if strings.TrimSpace(item) == image {
            return true
        }
    }
    return false
}

func maxServerMemoryMB() int {
    n, err := strconv.Atoi(env("CRAKNODE_MAX_SERVER_MEMORY_MB", "32768"))
    if err != nil || n < 512 {
        return 32768
    }
    if n > 1048576 {
        return 1048576
    }
    return n
}

func maxServerCPU() float64 {
    n, err := strconv.ParseFloat(env("CRAKNODE_MAX_SERVER_CPU", "16"), 64)
    if err != nil || n < 0.25 {
        return 16
    }
    if n > 1024 {
        return 1024
    }
    return n
}
