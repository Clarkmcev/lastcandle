package server

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/coder/websocket"

	"lastcandle/server/internal/game"
)

// Default caps on what one server runs at once. Every running match is
// simulated 20 times a second, so too many of them starve the CPU.
const (
	DefaultMaxRooms   = 60
	DefaultMaxMatches = 20
	// MaxRoomsPerIP stops one client from opening every room on the server.
	MaxRoomsPerIP = 3
)

// Hub owns every room, keyed by its join code.
type Hub struct {
	cfg     game.Config
	origins []string
	dev     bool // allow sandbox matches (developer mode)

	mu         sync.Mutex
	rooms      map[string]*Room
	matches    int // matches running now
	maxRooms   int // 0: no limit
	maxMatches int // 0: no limit
}

func NewHub(cfg game.Config, origins []string) *Hub {
	return &Hub{
		cfg: cfg, origins: origins, rooms: map[string]*Room{},
		maxRooms: DefaultMaxRooms, maxMatches: DefaultMaxMatches,
	}
}

// EnableDev lets room owners start sandbox matches.
func (h *Hub) EnableDev() { h.dev = true }

// SetLimits caps how many rooms can be open and how many matches can run at
// once; 0 means no limit.
func (h *Hub) SetLimits(rooms, matches int) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.maxRooms, h.maxMatches = rooms, matches
}

// acquireMatch reserves a slot for a match about to start, or reports that
// the server is already running as many as it may.
func (h *Hub) acquireMatch() bool {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.maxMatches > 0 && h.matches >= h.maxMatches {
		return false
	}
	h.matches++
	return true
}

func (h *Hub) releaseMatch() {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.matches--
}

// Codes skip letters that are easy to misread aloud (I, O, L).
const codeLetters = "ABCDEFGHJKMNPQRSTUVWXYZ"

// newRoom opens a room for ip, or says why it cannot.
func (h *Hub) newRoom(ip string) (*Room, string) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.maxRooms > 0 && len(h.rooms) >= h.maxRooms {
		return nil, "The manor is full right now. Try again in a few minutes."
	}
	mine := 0
	for _, r := range h.rooms {
		if r.ip == ip {
			mine++
		}
	}
	if mine >= MaxRoomsPerIP {
		return nil, "You already have too many rooms open. Close one and try again in a minute."
	}
	for {
		b := make([]byte, 4)
		rand.Read(b)
		code := make([]byte, 4)
		for i := range b {
			code[i] = codeLetters[int(b[i])%len(codeLetters)]
		}
		if _, taken := h.rooms[string(code)]; !taken {
			r := newRoom(h, string(code), ip)
			h.rooms[r.code] = r
			go r.run()
			return r, ""
		}
	}
}

func (h *Hub) room(code string) *Room {
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.rooms[strings.ToUpper(code)]
}

func (h *Hub) remove(r *Room) {
	h.mu.Lock()
	defer h.mu.Unlock()
	delete(h.rooms, r.code)
	log.Printf("room %s closed", r.code)
}

func randomHex(n int) string {
	b := make([]byte, n)
	rand.Read(b)
	return hex.EncodeToString(b)
}

// Handler serves the WebSocket endpoint, a health check, and the built web
// client from staticDir when it is not empty.
func (h *Hub) Handler(staticDir string) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/ws", h.ServeWS)
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, _ *http.Request) {
		h.mu.Lock()
		rooms, matches := len(h.rooms), h.matches
		h.mu.Unlock()
		fmt.Fprintf(w, "ok rooms=%d matches=%d", rooms, matches)
	})
	if staticDir != "" {
		mux.Handle("/", http.FileServer(http.Dir(staticDir)))
	}
	return mux
}

// ServeWS upgrades /ws?room=CODE&name=NAME&token=TOKEN. An empty room code
// creates a new room.
func (h *Hub) ServeWS(w http.ResponseWriter, req *http.Request) {
	conn, err := websocket.Accept(w, req, &websocket.AcceptOptions{OriginPatterns: h.origins})
	if err != nil {
		return
	}
	conn.SetReadLimit(4096)
	q := req.URL.Query()
	c := &Client{conn: conn, send: make(chan []byte, 64)}

	var r *Room
	if code := q.Get("room"); code == "" {
		var why string
		if r, why = h.newRoom(clientIP(req)); r == nil {
			c.closeWith(why)
			return
		}
	} else if r = h.room(code); r == nil {
		c.closeWith("No room with code " + strings.ToUpper(code))
		return
	}
	reply := make(chan string, 1)
	r.join <- joinReq{client: c, name: q.Get("name"), color: q.Get("color"), token: q.Get("token"), reply: reply}
	if msg := <-reply; msg != "" {
		c.closeWith(msg)
		return
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go c.writeLoop(ctx)
	c.readLoop(ctx, r)
	r.leave <- c
}

// clientIP is who sent req. Fly's proxy puts the real address in
// Fly-Client-IP; shortcut: off Fly a client can forge that header.
func clientIP(req *http.Request) string {
	if ip := req.Header.Get("Fly-Client-IP"); ip != "" {
		return ip
	}
	host, _, err := net.SplitHostPort(req.RemoteAddr)
	if err != nil {
		return req.RemoteAddr
	}
	return host
}

// Client is one browser connection.
type Client struct {
	id   string
	conn *websocket.Conn
	send chan []byte
}

func (c *Client) push(v any) {
	b, err := json.Marshal(v)
	if err != nil {
		log.Printf("marshal: %v", err)
		return
	}
	select {
	case c.send <- b:
	default: // a slow client misses a snapshot rather than stalling the room
	}
}

func (c *Client) closeWith(msg string) {
	b, _ := json.Marshal(map[string]string{"t": "error", "text": msg})
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	c.conn.Write(ctx, websocket.MessageText, b)
	c.conn.Close(websocket.StatusPolicyViolation, msg)
}

func (c *Client) writeLoop(ctx context.Context) {
	for {
		select {
		case <-ctx.Done():
			return
		case b, ok := <-c.send:
			if !ok {
				c.conn.Close(websocket.StatusNormalClosure, "")
				return
			}
			wctx, cancel := context.WithTimeout(ctx, 5*time.Second)
			err := c.conn.Write(wctx, websocket.MessageText, b)
			cancel()
			if err != nil {
				return
			}
		}
	}
}

func (c *Client) readLoop(ctx context.Context, r *Room) {
	for {
		_, data, err := c.conn.Read(ctx)
		if err != nil {
			return
		}
		var m inMsg
		if json.Unmarshal(data, &m) == nil {
			r.in <- clientMsg{client: c, msg: m}
		}
	}
}
