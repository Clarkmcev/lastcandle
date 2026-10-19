// Command lastcandle runs the Last Candle game server: the lobby, every
// match, and (optionally) the built web client.
package main

import (
	"context"
	"flag"
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
	portFile := flag.String("portfile", "", "write the port actually used to this file (the Vite dev proxy reads it)")
	flag.Parse()

	cfg := game.DefaultConfig()
	// Shorter nights make playtesting quicker, e.g. LASTCANDLE_HOUR_SECONDS=20.
	if v, err := strconv.ParseFloat(os.Getenv("LASTCANDLE_HOUR_SECONDS"), 64); err == nil && v > 0 {
		cfg.HourSeconds = v
	}
	if v, err := strconv.ParseFloat(os.Getenv("LASTCANDLE_DISCUSS_SECONDS"), 64); err == nil && v > 0 {
		cfg.Discuss = v
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
