package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"runtime"
	"strconv"
	"strings"
	"syscall"
	"time"
)

type registrationPayload struct {
	Name             string  `json:"name"`
	Location         string  `json:"location"`
	BaseURL          string  `json:"baseUrl"`
	APIToken         string  `json:"apiToken"`
	CapacityCPU      float64 `json:"capacityCpu"`
	CapacityMemoryMB int64   `json:"capacityMemoryMb"`
	CapacityDiskMB   int64   `json:"capacityDiskMb"`
	AgentVersion     string  `json:"agentVersion"`
}

func init() { go registrationLoop() }

func nodeCapacity() (int64, int64, error) {
	var info syscall.Sysinfo_t
	if err := syscall.Sysinfo(&info); err != nil {
		return 0, 0, fmt.Errorf("memory capacity: %w", err)
	}
	unit := uint64(info.Unit)
	if unit == 0 {
		return 0, 0, fmt.Errorf("memory capacity unit is zero")
	}
	memoryMB := int64(uint64(info.Totalram) * unit / 1024 / 1024)
	if memoryMB <= 0 {
		return 0, 0, fmt.Errorf("memory capacity is unavailable")
	}

	capacityPath := env("CRAKNODE_CAPACITY_PATH", "/backups")
	var fs syscall.Statfs_t
	if err := syscall.Statfs(capacityPath, &fs); err != nil {
		return 0, 0, fmt.Errorf("disk capacity for %s: %w", capacityPath, err)
	}
	diskMB := int64(fs.Blocks) * int64(fs.Bsize) / 1024 / 1024
	if diskMB <= 0 {
		return 0, 0, fmt.Errorf("disk capacity is unavailable")
	}
	return memoryMB, diskMB, nil
}

func registrationLoop() {
	panel := strings.TrimRight(env("CRAKNODE_PANEL_URL", ""), "/")
	registrationToken := env("CRAKNODE_REGISTRATION_TOKEN", "")
	apiToken := env("CRAKNODE_TOKEN", "")
	name := strings.TrimSpace(env("CRAKNODE_NAME", ""))
	location := strings.TrimSpace(env("CRAKNODE_LOCATION", ""))
	publicURL := strings.TrimRight(strings.TrimSpace(env("CRAKNODE_PUBLIC_URL", "")), "/")

	if panel == "" || registrationToken == "" {
		log.Println("auto registration disabled: CRAKNODE_PANEL_URL or CRAKNODE_REGISTRATION_TOKEN missing")
		return
	}
	if apiToken == "" || name == "" || location == "" || publicURL == "" {
		log.Println("auto registration disabled: CRAKNODE_TOKEN, CRAKNODE_NAME, CRAKNODE_LOCATION and CRAKNODE_PUBLIC_URL are required")
		return
	}

	interval := 60 * time.Second
	if n, err := strconv.Atoi(env("CRAKNODE_HEARTBEAT_INTERVAL", "60")); err == nil && n >= 15 && n <= 3600 {
		interval = time.Duration(n) * time.Second
	}
	client := &http.Client{Timeout: 8 * time.Second}

	send := func() {
		memoryMB, diskMB, err := nodeCapacity()
		if err != nil {
			log.Printf("node registration skipped: %v", err)
			return
		}
		cpu := runtime.NumCPU()
		if cpu <= 0 {
			log.Printf("node registration skipped: CPU capacity is unavailable")
			return
		}

		payload := registrationPayload{
			Name:             name,
			Location:         location,
			BaseURL:          publicURL,
			APIToken:         apiToken,
			CapacityCPU:      float64(cpu),
			CapacityMemoryMB: memoryMB,
			CapacityDiskMB:   diskMB,
			AgentVersion:     version,
		}
		raw, err := json.Marshal(payload)
		if err != nil {
			log.Printf("node registration payload failed: %v", err)
			return
		}
		req, err := http.NewRequest(http.MethodPost, panel+"/api/nodes/register", bytes.NewReader(raw))
		if err != nil {
			log.Printf("node registration request failed: %v", err)
			return
		}
		req.Header.Set("content-type", "application/json")
		req.Header.Set("x-craknode-registration-token", registrationToken)
		res, err := client.Do(req)
		if err != nil {
			log.Printf("node registration failed: %v", err)
			return
		}
		defer res.Body.Close()
		if res.StatusCode < 200 || res.StatusCode >= 300 {
			log.Printf("node registration rejected: HTTP %d", res.StatusCode)
			return
		}
		log.Printf("node registered/heartbeat sent: %s", name)
	}

	send()
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for range ticker.C {
		send()
	}
}
