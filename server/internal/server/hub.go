package server

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"log"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/coder/websocket"

	"lastcandle/server/internal/game"
)

// Hub owns every room, keyed by its join code.
type Hub struct {
	cfg     game.Config
	origins []string
	dev     bool // allow sandbox matches (developer mode)

	mu    sync.Mutex
	rooms map[string]*Room
}

func NewHub(cfg game.Config, origins []string) *Hub {
	return &Hub{cfg: cfg, origins: origins, rooms: map[string]*Room{}}
}

// EnableDev lets room owners start sandbox matches.
func (h *Hub) EnableDev() { h.dev = true }

// Codes skip letters that are easy to misread aloud (I, O, L).
const codeLetters = "ABCDEFGHJKMNPQRSTUVWXYZ"

func (h *Hub) newRoom() *Room {
	h.mu.Lock()
	defer h.mu.Unlock()
	for {
		b := make([]byte, 4)
		rand.Read(b)
		code := make([]byte, 4)
		for i := range b {
			code[i] = codeLetters[int(b[i])%len(codeLetters)]
		}
		if _, taken := h.rooms[string(code)]; !taken {
			r := newRoom(h, string(code))
			h.rooms[r.code] = r
			go r.run()
			return r
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
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, _ *http.Request) { w.Write([]byte("ok")) })
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
		r = h.newRoom()
	} else if r = h.room(code); r == nil {
		c.closeWith("No room with code " + strings.ToUpper(code))
		return
	}
	reply := make(chan string, 1)
	r.join <- joinReq{client: c, name: q.Get("name"), token: q.Get("token"), reply: reply}
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
