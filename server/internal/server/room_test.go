package server

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"

	"lastcandle/server/internal/game"
)

type testConn struct {
	t    *testing.T
	conn *websocket.Conn
}

func dial(t *testing.T, srv *httptest.Server, query string) *testConn {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	url := "ws" + strings.TrimPrefix(srv.URL, "http") + "/ws?" + query
	c, _, err := websocket.Dial(ctx, url, nil)
	if err != nil {
		t.Fatal(err)
	}
	return &testConn{t, c}
}

func (c *testConn) send(v any) {
	b, _ := json.Marshal(v)
	if err := c.conn.Write(context.Background(), websocket.MessageText, b); err != nil {
		c.t.Fatal(err)
	}
}

// waitFor reads messages until one of type typ arrives.
func (c *testConn) waitFor(typ string) map[string]any {
	c.t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	for {
		_, data, err := c.conn.Read(ctx)
		if err != nil {
			c.t.Fatalf("waiting for %q: %v", typ, err)
		}
		var m map[string]any
		json.Unmarshal(data, &m)
		if m["t"] == typ {
			return m
		}
	}
}

func TestLobbyToMatchOverWebSocket(t *testing.T) {
	hub := NewHub(game.DefaultConfig(), []string{"*"})
	srv := httptest.NewServer(hub.Handler(""))
	defer srv.Close()

	a := dial(t, srv, "name=Ada")
	welcome := a.waitFor("welcome")
	code := welcome["code"].(string)
	if len(code) != 4 {
		t.Fatalf("bad code %q", code)
	}

	b := dial(t, srv, "room="+strings.ToLower(code)+"&name=Bea")
	b.waitFor("welcome")
	lobby := b.waitFor("lobby")
	if n := len(lobby["players"].([]any)); n != 2 {
		t.Fatalf("expected 2 players in lobby, got %d", n)
	}

	a.send(map[string]any{"t": "addBot"})
	a.send(map[string]any{"t": "start"})
	start := a.waitFor("start")
	if r := start["role"]; r != "guest" && r != "host" {
		t.Fatalf("bad role %v", r)
	}
	b.waitFor("start")

	for seq := 1; seq <= 5; seq++ {
		a.send(map[string]any{"t": "cmd", "seq": seq, "dx": 1, "dy": 0})
	}
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		if snap := a.waitFor("snap"); snap["ack"].(float64) == 5 {
			return
		}
	}
	t.Fatal("server never acknowledged the movement commands")
}

func TestUnknownRoomIsRejected(t *testing.T) {
	hub := NewHub(game.DefaultConfig(), []string{"*"})
	srv := httptest.NewServer(hub.Handler(""))
	defer srv.Close()
	c := dial(t, srv, "room=ZZZZ&name=X")
	if e := c.waitFor("error"); !strings.Contains(e["text"].(string), "ZZZZ") {
		t.Fatalf("unexpected error %v", e)
	}
}
