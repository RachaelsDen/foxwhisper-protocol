package util

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"sync"
)

var (
	repoRootOnce sync.Once
	repoRootPath string
	repoRootErr  error
)

// RepoRoot locates the Git repository root by walking up from this package path.
func RepoRoot() (string, error) {
	repoRootOnce.Do(func() {
		_, filename, _, ok := runtime.Caller(0)
		if !ok {
			repoRootErr = errors.New("unable to determine caller path")
			return
		}
		dir := filepath.Dir(filename)
		for {
			if dir == "/" || dir == "." {
				repoRootErr = errors.New("git root not found")
				return
			}
			if _, err := os.Stat(filepath.Join(dir, ".git")); err == nil {
				repoRootPath = dir
				return
			}
			parent := filepath.Dir(dir)
			if parent == dir {
				repoRootErr = errors.New("git root not found")
				return
			}
			dir = parent
		}
	})
	return repoRootPath, repoRootErr
}

// SaveJSON writes a JSON payload into the repository-level results directory.
func SaveJSON(filename string, payload interface{}) error {
	root, err := RepoRoot()
	if err != nil {
		return err
	}
	outputDir := filepath.Join(root, "results")
	if err := os.MkdirAll(outputDir, 0o755); err != nil {
		return err
	}
	data, err := json.MarshalIndent(payload, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(outputDir, filename), data, 0o644)
}
