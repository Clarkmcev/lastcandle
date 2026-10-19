package server

import (
	"log"
	"slices"
	"strings"
	"time"
	"unicode/utf8"

	"lastcandle/server/internal/game"
)

const (
	MinPlayers = 3
	MaxPlayers = 10
)

// Each colour comes with a costume (client/src/sprites.ts), so a bot is
// named after the character its colour dresses it as.
var colors = []string{
	"#e04848", "#3f7fe0", "#3fae5a", "#e0c33f", "#9b5de5",
	"#f08a2c", "#e8e4dc", "#f06fb0", "#2fb8b0", "#9a6a3a",
}

var botNames = []string{
	"The Colonel", "The Gentleman", "The Widow", "The Poet", "The Physician",
	"The Governess", "The Clergyman", "The Heiress", "The Inventor", "The Gambler",
}

// inMsg is every message a client can send; T says which fields apply.
type inMsg struct {
	T      string  `json:"t"`
	Seq    int     `json:"seq"`
	DX     float64 `json:"dx"`
	DY     float64 `json:"dy"`
	Action string  `json:"action"`
	On     bool    `json:"on"`
	Target string  `json:"target"`
	Word   string  `json:"word"`
	Text   string  `json:"text"`
}

type clientMsg struct {
	client *Client
	msg    inMsg
}

type joinReq struct {
	client *Client
	name   string
	token  string
	reply  chan string
}

type member struct {
	id     string
	name   string
	color  string
	token  string
	bot    bool
	client *Client
}

type lobbyPlayer struct {
	ID     string `json:"id"`
	Name   string `json:"name"`
	Color  string `json:"color"`
	Bot    bool   `json:"bot,omitempty"`
	Online bool   `json:"online"`
}

// Room is one lobby and its matches. A single goroutine owns all of its
// state, so the game logic needs no locks.
type Room struct {
	hub     *Hub
	code    string
	join    chan joinReq
	leave   chan *Client
	in      chan clientMsg
	members []*member
	owner   string
	match   *game.Match
	state   string // lobby, playing, ended
}

func newRoom(h *Hub, code string) *Room {
	return &Room{
		hub: h, code: code, state: "lobby",
		join: make(chan joinReq), leave: make(chan *Client), in: make(chan clientMsg, 256),
	}
}

func (r *Room) run() {
	ticker := time.NewTicker(time.Duration(r.hub.cfg.Tick * float64(time.Second)))
	defer ticker.Stop()
	// A room nobody has joined yet (or everyone left) closes after a grace period.
	emptySince := time.Now()
	for {
		select {
		case j := <-r.join:
			j.reply <- r.onJoin(j)
		case c := <-r.leave:
			r.onLeave(c)
		case cm := <-r.in:
			r.handle(cm.client, cm.msg)
		case <-ticker.C:
			if r.state == "playing" {
				r.tick()
			}
		}
		if r.onlineHumans() > 0 {
			emptySince = time.Now()
		} else if time.Since(emptySince) > 30*time.Second {
			r.hub.remove(r)
			r.drain()
			return
		}
	}
}

// drain answers late joiners after the room has closed.
func (r *Room) drain() {
	go func() {
		for {
			select {
			case j := <-r.join:
				j.reply <- "That room has closed"
			case <-r.leave:
			case <-r.in:
			case <-time.After(time.Minute):
				return
			}
		}
	}()
}

func (r *Room) onlineHumans() int {
	n := 0
	for _, m := range r.members {
		if m.client != nil {
			n++
		}
	}
	return n
}

func (r *Room) byClient(c *Client) *member {
	for _, m := range r.members {
		if m.client == c {
			return m
		}
	}
	return nil
}

func (r *Room) byID(id string) *member {
	for _, m := range r.members {
		if m.id == id {
			return m
		}
	}
	return nil
}

func cleanName(s string) string {
	s = strings.TrimSpace(s)
	for utf8.RuneCountInString(s) > 16 {
		_, size := utf8.DecodeLastRuneInString(s)
		s = s[:len(s)-size]
	}
	if s == "" {
		return "Guest"
	}
	return s
}

func (r *Room) freeColor() string {
	for _, c := range colors {
		if !slices.ContainsFunc(r.members, func(m *member) bool { return m.color == c }) {
			return c
		}
	}
	return colors[0]
}

func (r *Room) onJoin(j joinReq) string {
	if j.token != "" {
		for _, m := range r.members {
			if m.token == j.token && !m.bot {
				if m.client != nil {
					m.client.conn.CloseNow()
				}
				m.client, j.client.id = j.client, m.id
				r.welcome(m)
				return ""
			}
		}
	}
	if r.state != "lobby" {
		return "That game has already started"
	}
	if len(r.members) >= MaxPlayers {
		return "That room is full"
	}
	m := &member{id: randomHex(4), name: cleanName(j.name), color: r.freeColor(), token: randomHex(8), client: j.client}
	j.client.id = m.id
	r.members = append(r.members, m)
	if o := r.byID(r.owner); o == nil || o.client == nil {
		r.owner = m.id
	}
	log.Printf("room %s: %s joined", r.code, m.name)
	r.welcome(m)
	return ""
}

func (r *Room) welcome(m *member) {
	m.client.push(map[string]any{"t": "welcome", "id": m.id, "token": m.token, "code": r.code})
	switch r.state {
	case "lobby":
		r.broadcastLobby()
	case "playing":
		m.client.push(r.match.StartFor(m.id))
	case "ended":
		m.client.push(r.match.StartFor(m.id))
		m.client.push(r.match.EndView())
		r.broadcastLobby()
	}
}

func (r *Room) onLeave(c *Client) {
	m := r.byClient(c)
	if m == nil {
		return
	}
	m.client = nil
	close(c.send)
	if r.state == "lobby" {
		r.members = slices.DeleteFunc(r.members, func(x *member) bool { return x == m })
	}
	if r.owner == m.id {
		r.owner = ""
		for _, x := range r.members {
			if x.client != nil {
				r.owner = x.id
				break
			}
		}
	}
	r.broadcastLobby()
}

func (r *Room) broadcast(v any) {
	for _, m := range r.members {
		if m.client != nil {
			m.client.push(v)
		}
	}
}

func (r *Room) broadcastLobby() {
	players := []lobbyPlayer{}
	for _, m := range r.members {
		players = append(players, lobbyPlayer{m.id, m.name, m.color, m.bot, m.bot || m.client != nil})
	}
	r.broadcast(map[string]any{
		"t": "lobby", "code": r.code, "owner": r.owner, "state": r.state,
		"players": players, "min": MinPlayers, "max": MaxPlayers,
	})
}

func (r *Room) handle(c *Client, msg inMsg) {
	m := r.byClient(c)
	if m == nil {
		return
	}
	isOwner := m.id == r.owner
	switch msg.T {
	case "start":
		if isOwner && r.state != "playing" {
			r.start(c)
		}
	case "addBot":
		if isOwner && r.state != "playing" && len(r.members) < MaxPlayers {
			color := r.freeColor()
			r.members = append(r.members, &member{
				id: randomHex(4), name: r.botName(color), color: color, bot: true,
			})
			r.broadcastLobby()
		}
	case "removeBot":
		if isOwner && r.state != "playing" {
			r.members = slices.DeleteFunc(r.members, func(x *member) bool { return x.bot && x.id == msg.Target })
			r.broadcastLobby()
		}
	case "lobby":
		if isOwner && r.state == "ended" {
			r.state, r.match = "lobby", nil
			r.members = slices.DeleteFunc(r.members, func(x *member) bool { return !x.bot && x.client == nil })
			r.broadcastLobby()
		}
	case "chat":
		r.chat(m, msg.Text)
	}
	if r.state != "playing" || r.match == nil {
		return
	}
	switch msg.T {
	case "cmd":
		r.match.QueueCmd(m.id, game.Cmd{Seq: msg.Seq, DX: clamp1(msg.DX), DY: clamp1(msg.DY)})
	case "hold":
		r.match.SetHold(m.id, msg.Action, msg.On)
	case "press":
		if text := r.match.Press(m.id, msg.Action); text != "" {
			c.push(map[string]string{"t": "event", "kind": "toast", "text": text})
		}
		r.flushEvents()
	case "write":
		if text := r.match.MirrorWrite(m.id, msg.Word); text != "" {
			c.push(map[string]string{"t": "event", "kind": "toast", "text": text})
		}
	case "vote":
		r.match.Vote(m.id, msg.Target)
	}
}

func clamp1(v float64) float64 {
	if v > 1 {
		return 1
	}
	if v < -1 {
		return -1
	}
	return v
}

func (r *Room) botName(color string) string {
	if i := slices.Index(colors, color); i >= 0 && !slices.ContainsFunc(r.members, func(m *member) bool { return m.name == botNames[i] }) {
		return botNames[i]
	}
	return "A Stranger"
}

func (r *Room) chat(m *member, text string) {
	text = strings.TrimSpace(text)
	if text == "" || utf8.RuneCountInString(text) > 200 {
		return
	}
	out := map[string]any{"t": "chat", "from": m.id, "name": m.name, "color": m.color, "text": text}
	if r.state != "playing" {
		r.broadcast(out)
		return
	}
	ok, ghost := r.match.CanChat(m.id)
	if !ok {
		return
	}
	if !ghost {
		r.broadcast(out)
		return
	}
	out["ghost"] = true
	for _, x := range r.members {
		if p := r.match.Player(x.id); x.client != nil && p != nil && p.Ghost {
			x.client.push(out)
		}
	}
}

func (r *Room) start(c *Client) {
	if len(r.members) < MinPlayers {
		c.push(map[string]string{"t": "event", "kind": "toast", "text": "Add players or bots: at least 3 are needed"})
		return
	}
	var seats []game.Seat
	for _, m := range r.members {
		if m.bot || m.client != nil {
			seats = append(seats, game.Seat{ID: m.id, Name: m.name, Color: m.color, Bot: m.bot})
		}
	}
	r.match = game.NewMatch(r.hub.cfg, seats, time.Now().UnixNano())
	r.state = "playing"
	log.Printf("room %s: match started with %d players", r.code, len(seats))
	for _, m := range r.members {
		if m.client != nil {
			m.client.push(r.match.StartFor(m.id))
		}
	}
}

func (r *Room) tick() {
	r.match.Tick()
	r.flushEvents()
	for _, m := range r.members {
		if m.client != nil && r.match.Player(m.id) != nil {
			m.client.push(r.match.SnapshotFor(m.id))
		}
	}
	if r.match.Phase == game.PhaseEnded {
		r.state = "ended"
		r.broadcast(r.match.EndView())
		r.broadcastLobby()
		log.Printf("room %s: %s won", r.code, r.match.Winner)
	}
}

func (r *Room) flushEvents() {
	for _, e := range r.match.TakeEvents() {
		out := map[string]any{"t": "event", "kind": e.Kind, "text": e.Text, "x": e.X, "y": e.Y}
		for _, m := range r.members {
			if m.client != nil && (e.To == nil || slices.Contains(e.To, m.id)) {
				m.client.push(out)
			}
		}
	}
}
