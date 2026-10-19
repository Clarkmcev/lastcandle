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

func TestOnlyTheOwnerChangesSettings(t *testing.T) {
	hub := NewHub(game.DefaultConfig(), []string{"*"})
	srv := httptest.NewServer(hub.Handler(""))
	defer srv.Close()

	a := dial(t, srv, "name=Ada")
	code := a.waitFor("welcome")["code"].(string)
	b := dial(t, srv, "room="+code+"&name=Bea")
	b.waitFor("lobby")

	discuss := func(lobby map[string]any) float64 { return lobby["values"].(map[string]any)["discuss"].(float64) }
	// A guest's change is ignored; the owner's next change shows it never took.
	b.send(map[string]any{"t": "settings", "values": map[string]any{"discuss": 10}})
	a.send(map[string]any{"t": "settings", "values": map[string]any{"roomWidth": 12}})
	if d := discuss(b.waitFor("lobby")); d != game.DefaultConfig().Discuss {
		t.Fatalf("a guest changed the discussion time to %v", d)
	}
	a.send(map[string]any{"t": "settings", "values": map[string]any{"discuss": 10}})
	if d := discuss(b.waitFor("lobby")); d != 10 {
		t.Fatalf("the owner's change did not reach the lobby: %v", d)
	}
	a.send(map[string]any{"t": "addBot"})
	a.send(map[string]any{"t": "start"})
	start := a.waitFor("start")
	// The match is built from the lobby's rules (here, its room width).
	if w := len(start["map"].(map[string]any)["rows"].([]any)[1].(string)); w != 3*12+6 {
		t.Fatalf("the manor should be built with 12-tile rooms, width %d", w)
	}
}

func TestOwnerChangesRulesMidMatch(t *testing.T) {
	hub := NewHub(game.DefaultConfig(), []string{"*"})
	srv := httptest.NewServer(hub.Handler(""))
	defer srv.Close()

	a := dial(t, srv, "name=Ada")
	a.waitFor("welcome")
	a.send(map[string]any{"t": "addBot"})
	a.send(map[string]any{"t": "addBot"})
	a.send(map[string]any{"t": "start"})
	a.waitFor("start")
	a.send(map[string]any{"t": "settings", "values": map[string]any{"speed": 8}})
	cfg := a.waitFor("config")["config"].(map[string]any)
	if cfg["speed"].(float64) != 8 {
		t.Fatalf("clients should get the new speed, got %v", cfg["speed"])
	}
	if v := a.waitFor("lobby")["values"].(map[string]any)["speed"].(float64); v != 8 {
		t.Fatalf("the settings page should show the new speed, got %v", v)
	}
}
