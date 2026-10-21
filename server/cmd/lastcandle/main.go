// Command lastcandle runs the Last Candle game server: the lobby, every
// match, and (optionally) the built web client.
package main

import (
	"context"
	"errors"
	"flag"
	"io/fs"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"syscall"

	"lastcandle/server/internal/game"
	"lastcandle/server/internal/server"
)

func main() {
	addr := flag.String("addr", ":8080", "listen address; the next free port is used if this one is taken")
	static := flag.String("static", "../client/dist", "directory of the built web client (skipped if missing)")
	origins := flag.String("origins", "localhost:*,127.0.0.1:*", "extra allowed WebSocket origins, comma separated")
	dev := flag.Bool("dev", false, "developer mode: open the client with ?dev to start an empty sandbox match")
	configPath := flag.String("config", "lastcandle.json", "JSON game config (speed, room size, …); defaults are used if the file is missing")
	maxRooms := flag.Int("max-rooms", server.DefaultMaxRooms, "most rooms open at once, 0 for no limit (env LASTCANDLE_MAX_ROOMS)")
	maxMatches := flag.Int("max-matches", server.DefaultMaxMatches, "most matches running at once, 0 for no limit (env LASTCANDLE_MAX_MATCHES)")
	portFile := flag.String("portfile", "", "write the port actually used to this file (the Vite dev proxy reads it)")
	flag.Parse()

	cfg, err := game.LoadConfig(*configPath)
	switch {
	case err == nil:
		log.Printf("game config from %s", *configPath)
	case errors.Is(err, fs.ErrNotExist) && !flagSet("config"):
		log.Printf("no %s; using the default game config", *configPath)
	default:
		log.Fatal(err)
	}
	// Shorter nights make playtesting quicker, e.g. LASTCANDLE_HOUR_SECONDS=20.
	if v, err := strconv.ParseFloat(os.Getenv("LASTCANDLE_HOUR_SECONDS"), 64); err == nil && v > 0 {
		cfg.HourSeconds = v
	}
	if v, err := strconv.ParseFloat(os.Getenv("LASTCANDLE_DISCUSS_SECONDS"), 64); err == nil && v > 0 {
		cfg.Discuss = v
	}

	if v, err := strconv.Atoi(os.Getenv("LASTCANDLE_MAX_ROOMS")); err == nil && v >= 0 {
		*maxRooms = v
	}
	if v, err := strconv.Atoi(os.Getenv("LASTCANDLE_MAX_MATCHES")); err == nil && v >= 0 {
		*maxMatches = v
	}

	staticDir := ""
	if st, err := os.Stat(*static); err == nil && st.IsDir() {
		staticDir = *static
		log.Printf("serving web client from %s", staticDir)
	} else {
		log.Printf("no web client at %s; run the Vite dev server or build the client", *static)
	}

	ln, err := server.Listen(*addr, 20)
	if err != nil {
		log.Fatal(err)
	}
	port := ln.Addr().(*net.TCPAddr).Port
	if !strings.HasSuffix(*addr, ":"+strconv.Itoa(port)) {
		log.Printf("%s is in use, using port %d instead", *addr, port)
	}
	if *portFile != "" {
		if err := os.WriteFile(*portFile, []byte(strconv.Itoa(port)), 0o644); err != nil {
			log.Fatal(err)
		}
		defer os.Remove(*portFile)
	}

	hub := server.NewHub(cfg, strings.Split(*origins, ","))
	hub.SetLimits(*maxRooms, *maxMatches)
	log.Printf("limits: %d rooms, %d running matches (0: no limit)", *maxRooms, *maxMatches)
	if *dev {
		hub.EnableDev()
		log.Printf("developer mode: add ?dev to the client URL for an empty test match")
	}
	srv := &http.Server{Handler: hub.Handler(staticDir)}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	go func() {
		<-ctx.Done()
		srv.Close()
	}()

	log.Printf("Last Candle listening on http://localhost:%d", port)
	if err := srv.Serve(ln); err != nil && err != http.ErrServerClosed {
		log.Print(err)
	}
}

func flagSet(name string) bool {
	set := false
	flag.Visit(func(f *flag.Flag) { set = set || f.Name == name })
	return set
}
