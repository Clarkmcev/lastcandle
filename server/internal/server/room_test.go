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
<<<<<<< Updated upstream
=======

func TestChoosingCharacters(t *testing.T) {
	hub := NewHub(game.DefaultConfig(), []string{"*"})
	srv := httptest.NewServer(hub.Handler(""))
	defer srv.Close()

	// Ada asks for the Widow's colour when she arrives.
	a := dial(t, srv, "name=Ada&color=%233fae5a")
	code := a.waitFor("welcome")["code"].(string)
	b := dial(t, srv, "room="+code+"&name=Bea&color=%233fae5a") // the same: already taken
	b.waitFor("welcome")
	players := func(l map[string]any) map[string]map[string]any {
		out := map[string]map[string]any{}
		for _, p := range l["players"].([]any) {
			pm := p.(map[string]any)
			out[pm["name"].(string)] = pm
		}
		return out
	}
	l := players(b.waitFor("lobby"))
	if l["Ada"]["color"] != "#3fae5a" || l["Bea"]["color"] == "#3fae5a" {
		t.Fatalf("Ada should have the colour she asked for and Bea another: %v", l)
	}

	// Bea cannot take Ada's character, but can take a bot's, and the bot
	// takes Bea's old one and its name.
	a.send(map[string]any{"t": "addBot"})
	a.waitFor("lobby")
	bea := l["Bea"]["color"].(string)
	b.send(map[string]any{"t": "pick", "color": "#3fae5a"})
	if c := players(b.waitFor("lobby"))["Bea"]["color"]; c != bea {
		t.Fatalf("Bea took Ada's character: %v", c)
	}
	l = players(b.waitFor("lobby"))
	var bot map[string]any
	for _, p := range l {
		if p["bot"] == true {
			bot = p
		}
	}
	botColor := bot["color"].(string)
	b.send(map[string]any{"t": "pick", "color": botColor})
	l = players(b.waitFor("lobby"))
	if l["Bea"]["color"] != botColor {
		t.Fatalf("Bea should have the bot's character, has %v", l["Bea"]["color"])
	}
	for name, p := range l {
		if p["bot"] == true && (p["color"] != bea || name != botNames[slices.Index(colors, bea)]) {
			t.Fatalf("the bot should take Bea's old character and its name: %s %v", name, p["color"])
		}
	}
}

func TestOwnerStopsTheMatch(t *testing.T) {
	hub := NewHub(game.DefaultConfig(), []string{"*"})
	srv := httptest.NewServer(hub.Handler(""))
	defer srv.Close()

	a := dial(t, srv, "name=Ada")
	code := a.waitFor("welcome")["code"].(string)
	b := dial(t, srv, "room="+code+"&name=Bea")
	b.waitFor("welcome")
	a.send(map[string]any{"t": "addBot"})
	a.send(map[string]any{"t": "start"})
	b.waitFor("start")

	// Skip lobby updates from before the match: its start sends one in the
	// playing state.
	for _, c := range []*testConn{a, b} {
		for c.waitFor("lobby")["state"] != "playing" {
		}
	}
	// A guest cannot stop it: a settings change afterwards still finds the
	// match in progress.
	b.send(map[string]any{"t": "stop"})
	a.send(map[string]any{"t": "settings", "values": map[string]any{"speed": 5}})
	for _, c := range []*testConn{a, b} {
		if st := c.waitFor("lobby")["state"]; st != "playing" {
			t.Fatalf("a guest stopped the match: %v", st)
		}
	}
	// The owner can, and everyone is back in the lobby.
	a.send(map[string]any{"t": "stop"})
	for _, c := range []*testConn{a, b} {
		l := c.waitFor("lobby")
		if l["state"] != "lobby" {
			t.Fatalf("after the stop the room should be in its lobby, is %v", l["state"])
		}
		if n := len(l["players"].([]any)); n != 3 {
			t.Fatalf("everyone should still be in the lobby, got %d", n)
		}
	}
}

func TestRoomLimit(t *testing.T) {
	hub := NewHub(game.DefaultConfig(), []string{"*"})
	hub.SetLimits(1, 0)
	srv := httptest.NewServer(hub.Handler(""))
	defer srv.Close()

	a := dial(t, srv, "name=Ada")
	code := a.waitFor("welcome")["code"].(string)
	b := dial(t, srv, "name=Bea")
	if e := b.waitFor("error"); !strings.Contains(e["text"].(string), "full") {
		t.Fatalf("a second room should be refused, got %v", e)
	}
	// Joining the open room still works.
	c := dial(t, srv, "room="+code+"&name=Cy")
	c.waitFor("welcome")
}

func TestMatchLimit(t *testing.T) {
	hub := NewHub(game.DefaultConfig(), []string{"*"})
	hub.SetLimits(0, 1)
	srv := httptest.NewServer(hub.Handler(""))
	defer srv.Close()

	owner := func(name string) *testConn {
		c := dial(t, srv, "name="+name)
		c.waitFor("welcome")
		c.send(map[string]any{"t": "addBot"})
		c.send(map[string]any{"t": "addBot"})
		return c
	}
	a, b := owner("Ada"), owner("Bea")
	a.send(map[string]any{"t": "start"})
	a.waitFor("start")

	// The only slot is taken: Bea is told to wait.
	b.send(map[string]any{"t": "start"})
	for {
		if e := b.waitFor("event"); e["kind"] == "toast" {
			if !strings.Contains(e["text"].(string), "Too many games") {
				t.Fatalf("unexpected toast %v", e)
			}
			break
		}
	}

	// Stopping Ada's match frees the slot, once and only once.
	a.send(map[string]any{"t": "stop"})
	for a.waitFor("lobby")["state"] != "lobby" {
	}
	a.send(map[string]any{"t": "stop"}) // not playing: no second release
	b.send(map[string]any{"t": "start"})
	b.waitFor("start")
	hub.mu.Lock()
	n := hub.matches
	hub.mu.Unlock()
	if n != 1 {
		t.Fatalf("one match should be running, the hub counts %d", n)
	}
}
>>>>>>> Stashed changes
