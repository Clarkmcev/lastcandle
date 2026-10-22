package server

import (
	"log"
	"slices"
	"strings"
	"sync/atomic"
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
	Dev    bool    `json:"dev"`
	Role   string  `json:"role"`
	// Values holds settings changes, by setting key (see game.Settings).
	Values map[string]float64 `json:"values"`
	Color  string             `json:"color"`
}

type clientMsg struct {
	client *Client
	msg    inMsg
}

type joinReq struct {
	client *Client
	name   string
	color  string // the character the player would like, if it is free
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
	ip      string // who opened the room
	join    chan joinReq
	leave   chan *Client
	in      chan clientMsg
	members []*member
	owner   string
	match   *game.Match
	state   string // lobby, playing, ended
	slot    bool   // whether this room holds one of the hub's match slots
	// cfg is this room's rules: the server's config, as changed by the
	// owner on the settings page.
	cfg game.Config
	// info is what the hub's /rooms page shows: a copy the room goroutine
	// publishes, since only it may touch the fields above.
	info    atomic.Pointer[roomInfo]
	created time.Time
}

type roomInfo struct {
	Code    string    `json:"code"`
	State   string    `json:"state"`
	Players int       `json:"players"` // bots included
	Online  int       `json:"online"`  // humans connected now
	Created time.Time `json:"created"`
}

func newRoom(h *Hub, code, ip string) *Room {
	r := &Room{
		hub: h, code: code, ip: ip, state: "lobby", cfg: h.cfg, created: time.Now(),
		join: make(chan joinReq), leave: make(chan *Client), in: make(chan clientMsg, 256),
	}
	r.publish()
	return r
}

func (r *Room) publish() {
	r.info.Store(&roomInfo{Code: r.code, State: r.state, Players: len(r.members), Online: r.onlineHumans(), Created: r.created})
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
		r.publish()
		if r.onlineHumans() > 0 {
			emptySince = time.Now()
		} else if time.Since(emptySince) > 30*time.Second {
			r.releaseSlot()
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

// colorTaken reports who holds a character (a colour), or nil.
func (r *Room) colorTaken(color string) *member {
	for _, m := range r.members {
		if m.color == color {
			return m
		}
	}
	return nil
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
	color := r.freeColor()
	if slices.Contains(colors, j.color) && r.colorTaken(j.color) == nil {
		color = j.color
	}
	m := &member{id: randomHex(4), name: cleanName(j.name), color: color, token: randomHex(8), client: j.client}
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
	if r.state == "playing" {
		// Keys held when the connection dropped are let go.
		r.match.SetHold(m.id, "interact", false)
		r.match.SetHold(m.id, "snuff", false)
	}
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
		"settings": game.Settings, "values": r.cfg.SettingValues(), "defaults": r.hub.cfg.SettingValues(),
		"characters": characters(),
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
			if msg.Dev {
				r.startDev(c, msg.Role)
			} else {
				r.start(c)
			}
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
	case "stop":
		// The owner calls the night off: everyone goes back to the lobby.
		if isOwner && r.state == "playing" {
			log.Printf("room %s: %s stopped the match", r.code, m.name)
			r.backToLobby()
		}
	case "lobby":
		if isOwner && r.state == "ended" {
			r.backToLobby()
		}
	case "settings":
		// Only the owner changes the rules, in the lobby or mid-match. An
		// invalid change is dropped; the lobby goes out again either way so
		// every settings page shows the rules actually in force.
		if isOwner {
			r.changeSettings(msg.Values)
		}
	case "pick":
		// Choose a character before the night. A bot gives its character up
		// (and takes yours); another player's is not yours to take.
		if r.state != "playing" && slices.Contains(colors, msg.Color) && msg.Color != m.color {
			if other := r.colorTaken(msg.Color); other == nil || other.bot {
				if other != nil {
					wasDefault := other.name == r.botNameFor(other.color)
					other.color = m.color
					if wasDefault {
						other.name = r.botNameFor(other.color)
					}
				}
				m.color = msg.Color
			}
		}
		r.broadcastLobby()
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

func (r *Room) changeSettings(values map[string]float64) {
	if err := r.cfg.ApplySettings(values); err != nil {
		log.Printf("room %s: settings: %v", r.code, err)
	} else if r.state == "playing" {
		// The night in progress takes the change too, and every client
		// gets the rules it predicts movement with.
		r.match.ApplySettings(values)
		r.broadcast(map[string]any{"t": "config", "config": r.match.ClientConfig()})
	}
	r.broadcastLobby()
}

type character struct {
	Color string `json:"color"`
	Name  string `json:"name"`
}

// characters lists every character a player can choose, by colour.
func characters() []character {
	out := make([]character, len(colors))
	for i, c := range colors {
		out[i] = character{c, botNames[i]}
	}
	return out
}

// backToLobby ends the match and returns the room to its lobby; players
// who have left for good are dropped.
func (r *Room) backToLobby() {
	r.releaseSlot()
	r.state, r.match = "lobby", nil
	r.members = slices.DeleteFunc(r.members, func(x *member) bool { return !x.bot && x.client == nil })
	r.broadcastLobby()
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

// botNameFor is the character's own name, which bots go by.
func (r *Room) botNameFor(color string) string {
	if i := slices.Index(colors, color); i >= 0 {
		return botNames[i]
	}
	return "A Stranger"
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
	if !r.takeSlot(c) {
		return
	}
	var seats []game.Seat
	for _, m := range r.members {
		if m.bot || m.client != nil {
			seats = append(seats, game.Seat{ID: m.id, Name: m.name, Color: m.color, Bot: m.bot})
		}
	}
	r.match = game.NewMatch(r.cfg, seats, time.Now().UnixNano())
	r.state = "playing"
	log.Printf("room %s: match started with %d players", r.code, len(seats))
	for _, m := range r.members {
		if m.client != nil {
			m.client.push(r.match.StartFor(m.id))
		}
	}
	r.broadcastLobby() // the settings page now shows the match's rules
}

// startDev starts a sandbox match (developer mode) with whoever is in the
// room, even alone: no minimum, no grace period, and it never ends. The owner
// picks their role and everyone else is a guest, so bots never hunt them.
func (r *Room) startDev(c *Client, role string) {
	if !r.hub.dev {
		c.push(map[string]string{"t": "error", "text": "Developer mode is off. Start the server with -dev (make dev-server does)."})
		return
	}
	if !r.takeSlot(c) {
		return
	}
	var seats []game.Seat
	for _, m := range r.members {
		if m.bot || m.client != nil {
			s := game.Seat{ID: m.id, Name: m.name, Color: m.color, Bot: m.bot, Role: game.RoleGuest}
			if m.id == r.owner && role == "host" {
				s.Role = game.RoleHost
			}
			seats = append(seats, s)
		}
	}
	cfg := r.cfg
	cfg.Sandbox, cfg.Grace = true, 0
	r.match = game.NewMatch(cfg, seats, time.Now().UnixNano())
	r.state = "playing"
	log.Printf("room %s: developer match started with %d players", r.code, len(seats))
	for _, m := range r.members {
		if m.client != nil {
			m.client.push(r.match.StartFor(m.id))
		}
	}
	r.broadcastLobby() // the settings page now shows the match's rules
}

// takeSlot reserves a match slot on the hub before a match starts, telling
// the owner when every slot is in use.
func (r *Room) takeSlot(c *Client) bool {
	if r.slot {
		return true
	}
	if !r.hub.acquireMatch() {
		c.push(map[string]string{"t": "event", "kind": "toast", "text": "Too many games are running right now. Try again in a few minutes."})
		return false
	}
	r.slot = true
	return true
}

// releaseSlot gives the room's match slot back once its match is over.
func (r *Room) releaseSlot() {
	if r.slot {
		r.slot = false
		r.hub.releaseMatch()
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
		r.releaseSlot()
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
