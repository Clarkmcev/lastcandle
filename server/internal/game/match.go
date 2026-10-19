package game

import (
	"fmt"
	"math"
	"math/rand"
	"slices"
)

type Team string

const (
	TeamGuests Team = "guests"
	TeamManor  Team = "manor"
)

type Role string

const (
	RoleGuest Role = "guest"
	RoleHost  Role = "host"
)

type Phase string

const (
	PhasePlay    Phase = "play"
	PhaseMeeting Phase = "meeting"
	PhaseEnded   Phase = "ended"
)

// Hold kinds shown on the client's progress ring.
const (
	HoldRefill = "refill"
	HoldHearth = "hearth"
	HoldSearch = "search"
	HoldRead   = "read"
)

// MirrorWords is the fixed list ghosts can write on fogged mirrors.
var MirrorWords = []string{
	"HOST", "LIAR", "INNOCENT", "SAFE", "DANGER", "HELP", "HERE", "RUN",
	"LIBRARY", "CHAPEL", "NURSERY", "STUDY", "DINING", "BALLROOM", "CONSERVATORY",
	"ENTRANCE", "KITCHEN", "CELLAR", "PAGE", "ALTAR", "HEARTH", "MIRROR",
	"RED", "BLUE", "GREEN", "YELLOW", "PURPLE", "ORANGE", "WHITE", "PINK", "TEAL", "BROWN",
	"YES", "NO", "WAIT", "TRUST", "WATCH", "BEHIND",
}

type Cmd struct {
	Seq int
	DX  float64
	DY  float64
}

type Seat struct {
	ID    string
	Name  string
	Color string
	Bot   bool
	Role  Role // forced role; if any seat sets one, unset seats are guests
}

type Player struct {
	ID       string
	Name     string
	Color    string
	Bot      bool
	Role     Role
	Team     Team
	Pos      Vec
	Alive    bool
	Ghost    bool
	Restless bool
	Wax      float64
	Lit      bool
	Pages    int
	SnuffCD  float64
	KillCD   float64
	SabCD    float64
	Seance   bool // séance already used
	Ecto     int
	LastSeq  int

	Interact    bool
	SnuffOn     bool
	interactWas bool
	edgeUsed    bool
	holdKind    string
	holdTarget  int
	holdT       float64
	snuffTarget string
	snuffT      float64
	passCD      float64
	shock       float64

	cmds    []Cmd
	history []Vec
	dripT   float64
	voted   bool
	vote    string
	brain   *brain
	botDir  Vec
}

func (p *Player) living() bool { return p.Alive && !p.Ghost }

type Hearth struct {
	Pos     Vec
	Lit     bool
	Relight float64
}

type Body struct {
	ID  string // the dead player's id
	Pos Vec
}

type Smoke struct {
	Pos Vec
	Dir Vec
	T   float64
}

type Drip struct {
	Pos   Vec
	Color string
	T     float64
}

type Spot struct {
	Pos      Vec
	HasPage  bool
	Searched bool
}

type mirrorWord struct {
	Word string
	T    float64
}

type Meeting struct {
	Reason string // dinner, body, seance
	Caller string
	Body   string
	Stage  string // gather, discuss, vote, result
	T      float64
	Locked string
	Text   string
	Tally  map[string]int
}

type Event struct {
	Kind string   `json:"kind"`
	To   []string `json:"-"` // nil means everyone
	X    float64  `json:"x,omitempty"`
	Y    float64  `json:"y,omitempty"`
	Text string   `json:"text,omitempty"`
}

type Match struct {
	Cfg     Config
	Map     *Map
	Players []*Player
	byID    map[string]*Player

	Phase      Phase
	Clock      float64
	hour       int
	Hearths    []*Hearth
	Bodies     []*Body
	Smoke      []*Smoke
	Drips      []*Drip
	Spots      []*Spot
	Loose      []Vec
	AltarPages int
	Read       float64
	Meeting    *Meeting
	words      map[int]*mirrorWord
	deaths     int
	restless   bool
	sandboxEnd string // last ending sandbox mode suppressed

	Winner    Team
	WinReason string
	events    []Event
	rng       *rand.Rand
}

func NewMatch(cfg Config, seats []Seat, seed int64) *Match {
	m := &Match{
		Cfg:   cfg,
		Map:   BuildManor(cfg.RoomWidth, cfg.RoomHeight),
		byID:  map[string]*Player{},
		Phase: PhasePlay,
		words: map[int]*mirrorWord{},
		rng:   rand.New(rand.NewSource(seed)),
	}
	order := m.rng.Perm(len(seats))
	hosts := HostCount(len(seats))
	forced := slices.ContainsFunc(seats, func(s Seat) bool { return s.Role != "" })
	for i, idx := range order {
		s := seats[idx]
		p := &Player{
			ID: s.ID, Name: s.Name, Color: s.Color, Bot: s.Bot,
			Role: RoleGuest, Team: TeamGuests,
			Alive: true, Lit: true, Wax: cfg.StartWax,
			KillCD: cfg.KillCD, SnuffCD: cfg.Grace, SabCD: cfg.Grace,
		}
		if forced {
			if s.Role == RoleHost {
				p.Role, p.Team = RoleHost, TeamManor
			}
		} else if i < hosts {
			p.Role, p.Team = RoleHost, TeamManor
		}
		if cfg.Sandbox {
			p.KillCD = 0
		}
		if s.Bot {
			p.brain = &brain{}
		}
		m.byID[p.ID] = p
	}
	// Keep the lobby order so seats and colors stay stable.
	for i, s := range seats {
		p := m.byID[s.ID]
		a := 2 * math.Pi * float64(i) / float64(len(seats))
		p.Pos = m.Map.Spawn.Add(Vec{math.Cos(a) * 2, math.Sin(a) * 2})
		m.Players = append(m.Players, p)
	}
	for _, h := range m.Map.Hearths {
		m.Hearths = append(m.Hearths, &Hearth{Pos: h, Lit: true})
	}
	for _, s := range m.Map.Spots {
		m.Spots = append(m.Spots, &Spot{Pos: s})
	}
	for _, i := range m.rng.Perm(len(m.Spots))[:4] {
		m.Spots[i].HasPage = true
	}
	return m
}

func (m *Match) Player(id string) *Player { return m.byID[id] }

func (m *Match) TakeEvents() []Event {
	ev := m.events
	m.events = nil
	return ev
}

func (m *Match) emit(e Event) { m.events = append(m.events, e) }

func (m *Match) toast(text string, to ...string) {
	m.emit(Event{Kind: "toast", Text: text, To: to})
}

func (m *Match) graceOver() bool { return m.Clock >= m.Cfg.Grace }

// Hour is the in-game hour index: 0 is 10 PM, 8 is dawn.
func (m *Match) Hour() int { return int(m.Clock / m.Cfg.HourSeconds) }

// ClockFace returns the in-game time as a 24h hour and minute.
func (m *Match) ClockFace() (int, int) {
	mins := int(m.Clock / m.Cfg.HourSeconds * 60)
	return (22 + mins/60) % 24, mins % 60
}

// Radius is how far a player's light reaches.
func (m *Match) Radius(p *Player) float64 {
	if p.Ghost {
		return 99
	}
	if !p.Lit {
		return m.Cfg.OutRadius
	}
	r := m.Cfg.FullRadius
	if p.Wax < 50 {
		r *= 0.4 + 0.6*p.Wax/50
	}
	for _, q := range m.Players {
		if q != p && q.living() && q.Lit && q.Pos.Dist(p.Pos) <= m.Cfg.ShareRange {
			return r * m.Cfg.ShareBonus
		}
	}
	return r
}

// inLight reports whether pos is lit by a hearth or by a candle other than
// those carried by excluded players.
func (m *Match) inLight(pos Vec, exclude func(*Player) bool) bool {
	for _, h := range m.Hearths {
		if h.Lit && h.Pos.Dist(pos) <= m.Cfg.HearthRadius && m.Map.LineOfSight(h.Pos, pos) {
			return true
		}
	}
	for _, q := range m.Players {
		if !q.living() || !q.Lit || exclude(q) {
			continue
		}
		if q.Pos.Dist(pos) <= m.Radius(q) && m.Map.LineOfSight(q.Pos, pos) {
			return true
		}
	}
	return false
}

// canSeePoint: is pos inside the viewer's own light, or lit and in sight?
func (m *Match) canSeePoint(v *Player, pos Vec, litThere bool) bool {
	if v.Ghost {
		return true
	}
	d := v.Pos.Dist(pos)
	if d > m.Cfg.FarCandleSight || !m.Map.LineOfSight(v.Pos, pos) {
		return false
	}
	if d <= m.Radius(v)+0.3 || litThere {
		return true
	}
	return m.inLight(pos, func(*Player) bool { return false })
}

func (m *Match) canSee(v, t *Player) bool {
	if v == t {
		return true
	}
	if t.Ghost {
		return v.Ghost
	}
	return m.canSeePoint(v, t.Pos, t.Lit)
}

// ---------------------------------------------------------------- input

func (m *Match) QueueCmd(id string, c Cmd) {
	p := m.byID[id]
	if p == nil || c.Seq <= p.LastSeq {
		return
	}
	if len(p.cmds) >= 8 {
		p.cmds = p.cmds[1:]
	}
	p.cmds = append(p.cmds, c)
}

func (m *Match) SetHold(id, action string, on bool) {
	p := m.byID[id]
	if p == nil {
		return
	}
	switch action {
	case "interact":
		p.Interact = on
	case "snuff":
		p.SnuffOn = on
	}
}

// Press handles one-shot actions and returns a message when it fails.
func (m *Match) Press(id, action string) string {
	p := m.byID[id]
	if p == nil || m.Phase != PhasePlay {
		return ""
	}
	switch action {
	case "kill":
		return m.kill(p)
	case "report":
		return m.report(p)
	case "seance":
		return m.seance(p)
	case "sab_draft":
		return m.sabDraft(p)
	case "sab_hearth":
		return m.sabHearth(p)
	case "knock":
		return m.knock(p)
	}
	return ""
}

func (m *Match) kill(p *Player) string {
	if p.Role != RoleHost || !p.living() {
		return ""
	}
	if !m.graceOver() || p.KillCD > 0 {
		return "Kill is not ready"
	}
	var target *Player
	best := m.Cfg.KillRange
	for _, q := range m.Players {
		if q.living() && q.Role != RoleHost && !q.Lit {
			if d := q.Pos.Dist(p.Pos); d <= best {
				target, best = q, d
			}
		}
	}
	if target == nil {
		return "Nobody in the dark within reach"
	}
	if m.inLight(target.Pos, func(q *Player) bool { return q.Role == RoleHost || q == target }) {
		return "They are still in someone's light"
	}
	m.die(target, true)
	p.KillCD = m.Cfg.KillCD
	m.emit(Event{Kind: "killed", To: []string{target.ID}, Text: "You were killed in the dark. You are now a ghost."})
	m.sound("kill", target.Pos, p.ID, target.ID)
	m.checkWin()
	return ""
}

// sound plays a noise at pos for everyone within earshot, living or dead,
// and always for the players named. Hearing a snuff or a struggle in the
// dark nearby is a clue, so it travels through walls but not far.
func (m *Match) sound(name string, pos Vec, always ...string) {
	var to []string
	for _, q := range m.Players {
		if slices.Contains(always, q.ID) || q.Pos.Dist(pos) <= m.Cfg.HearRange {
			to = append(to, q.ID)
		}
	}
	m.emit(Event{Kind: "sound", Text: name, X: pos.X, Y: pos.Y, To: to})
}

func (m *Match) die(p *Player, body bool) {
	p.Alive, p.Ghost, p.Lit = false, true, false
	p.Interact, p.SnuffOn = false, false
	p.Ecto = m.Cfg.EctoPerHour
	for i := 0; i < p.Pages; i++ {
		m.Loose = append(m.Loose, p.Pos)
	}
	p.Pages = 0
	if body {
		m.Bodies = append(m.Bodies, &Body{ID: p.ID, Pos: p.Pos})
	}
	if p.Team == TeamGuests {
		if m.deaths > 0 && !m.restless && m.rng.Float64() < m.Cfg.RestlessChance {
			m.restless = true
			p.Restless, p.Team = true, TeamManor
			m.emit(Event{Kind: "restless", To: []string{p.ID}, Text: "The manor has claimed your spirit. You are a Restless Spirit: help the Host win."})
		}
		m.deaths++
	}
}

func (m *Match) report(p *Player) string {
	if !p.living() {
		return ""
	}
	for _, b := range m.Bodies {
		if b.Pos.Dist(p.Pos) <= m.Cfg.ReportRange {
			m.startMeeting("body", p.ID, b.ID)
			return ""
		}
	}
	return "No body nearby"
}

func (m *Match) seance(p *Player) string {
	if !p.living() {
		return ""
	}
	if m.Map.Table.DistTo(p.Pos) > 1.5 {
		return "Stand at the dining table to call a séance"
	}
	if p.Seance {
		return "You have already called your séance"
	}
	if p.Wax < m.Cfg.SeanceCost {
		return fmt.Sprintf("A séance costs %.0f wax", m.Cfg.SeanceCost)
	}
	p.Wax -= m.Cfg.SeanceCost
	p.Seance = true
	m.startMeeting("seance", p.ID, "")
	return ""
}

func (m *Match) sabReady(p *Player) string {
	if p.Role != RoleHost || !p.living() {
		return "-"
	}
	if !m.graceOver() || p.SabCD > 0 {
		return "Sabotage is not ready"
	}
	return ""
}

func (m *Match) sabDraft(p *Player) string {
	if msg := m.sabReady(p); msg != "" {
		return trimDash(msg)
	}
	room := m.Map.RoomAt(p.Pos)
	if room < 0 {
		return "Step into a room first"
	}
	var hit []string
	for _, q := range m.Players {
		if q.living() && m.Map.RoomAt(q.Pos) == room {
			hit = append(hit, q.ID)
			if q.Lit && q != p {
				q.Wax = math.Max(0, q.Wax-m.Cfg.DraftWax)
				if q.Wax == 0 {
					q.Lit = false
				}
			}
		}
	}
	m.emit(Event{Kind: "draft", To: hit, Text: "A cold draft rushes through the " + m.Map.Rooms[room].Name})
	m.setSabCD()
	return ""
}

func (m *Match) sabHearth(p *Player) string {
	if msg := m.sabReady(p); msg != "" {
		return trimDash(msg)
	}
	var target *Hearth
	best := math.Inf(1)
	for _, h := range m.Hearths {
		if d := h.Pos.Dist(p.Pos); h.Lit && d < best {
			target, best = h, d
		}
	}
	if target == nil {
		return ""
	}
	m.coldHearth(target)
	m.setSabCD()
	m.checkWin()
	return ""
}

func (m *Match) setSabCD() {
	for _, q := range m.Players {
		if q.Role == RoleHost {
			q.SabCD = m.Cfg.SabCD
		}
	}
}

func trimDash(s string) string {
	if s == "-" {
		return ""
	}
	return s
}

func (m *Match) coldHearth(h *Hearth) {
	h.Lit, h.Relight = false, 0
	room := m.Map.RoomAt(h.Pos)
	name := "a room"
	if room >= 0 {
		name = "the " + m.Map.Rooms[room].Name
	}
	m.toast("A hearth has gone cold in " + name)
}

func (m *Match) knock(p *Player) string {
	if !p.Ghost {
		return ""
	}
	if p.Ecto < 1 {
		return "No ectoplasm left this hour"
	}
	p.Ecto--
	var to []string
	for _, q := range m.Players {
		if q.living() && q.Pos.Dist(p.Pos) <= m.Cfg.KnockRange {
			to = append(to, q.ID)
		}
	}
	to = append(to, p.ID)
	m.emit(Event{Kind: "knock", To: to, X: p.Pos.X, Y: p.Pos.Y})
	return ""
}

func (m *Match) MirrorWrite(id, word string) string {
	p := m.byID[id]
	if p == nil || !p.Ghost || m.Phase != PhasePlay || !slices.Contains(MirrorWords, word) {
		return ""
	}
	mi := m.nearMirror(p.Pos)
	if mi < 0 {
		return "Float next to a mirror to write on it"
	}
	if p.Ecto < 2 && m.Hour() != 5 {
		return "Writing costs 2 ectoplasm"
	}
	if m.Hour() != 5 {
		p.Ecto -= 2
	}
	m.words[mi] = &mirrorWord{Word: word, T: m.Cfg.MirrorWordTime}
	return ""
}

func (m *Match) nearMirror(pos Vec) int {
	for i, mp := range m.Map.Mirrors {
		if mp.Dist(pos) <= m.Cfg.MirrorRange {
			return i
		}
	}
	return -1
}

func (m *Match) Vote(id, target string) {
	p := m.byID[id]
	mt := m.Meeting
	if p == nil || mt == nil || mt.Stage != "vote" || !p.living() || p.voted {
		return
	}
	if target != "" {
		t := m.byID[target]
		if t == nil || !t.living() {
			return
		}
	}
	p.voted, p.vote = true, target
}

// CanChat reports whether a player may send chat now, and on which channel.
func (m *Match) CanChat(id string) (ok bool, ghost bool) {
	p := m.byID[id]
	if p == nil {
		return false, false
	}
	if p.Ghost {
		return true, true
	}
	return m.Phase == PhaseMeeting && m.Meeting.Stage != "gather", false
}

// ----------------------------------------------------------------- tick

func (m *Match) Tick() {
	dt := m.Cfg.Tick
	switch m.Phase {
	case PhaseEnded:
		return
	case PhaseMeeting:
		for _, p := range m.Players {
			// Nobody moves at the table, but inputs are still acknowledged.
			if len(p.cmds) > 0 {
				p.LastSeq = p.cmds[len(p.cmds)-1].Seq
				p.cmds = p.cmds[:0]
			}
			if p.brain != nil {
				m.botThink(p, dt)
			}
		}
		m.updateMeeting(dt)
		return
	}

	m.Clock += dt
	if h := m.Hour(); h != m.hour {
		m.hour = h
		if m.onHour(h) {
			return
		}
	}

	for _, p := range m.Players {
		if p.brain != nil {
			m.botThink(p, dt)
		}
		m.move(p, dt)
		p.history = append(p.history, p.Pos)
		if len(p.history) > m.Cfg.MirrorLagTicks+1 {
			p.history = p.history[1:]
		}
		p.SnuffCD = math.Max(0, p.SnuffCD-dt)
		p.KillCD = math.Max(0, p.KillCD-dt)
		p.SabCD = math.Max(0, p.SabCD-dt)
		p.passCD = math.Max(0, p.passCD-dt)
		p.shock = math.Max(0, p.shock-dt)
		if p.living() && p.Lit {
			p.Wax = math.Max(0, p.Wax-m.Cfg.BurnPerSec*dt)
			if p.Wax == 0 {
				p.Lit = false
				m.toast("Your candle has guttered out. Refill it at a hearth.", p.ID)
			}
		}
	}

	m.updateInteractions(dt)
	if m.Phase != PhasePlay {
		return
	}
	for _, p := range m.Players {
		m.updateSnuff(p, dt)
	}

	m.Smoke = expire(m.Smoke, dt, func(s *Smoke) *float64 { return &s.T })
	m.Drips = expire(m.Drips, dt, func(d *Drip) *float64 { return &d.T })
	for i, w := range m.words {
		if w.T -= dt; w.T <= 0 {
			delete(m.words, i)
		}
	}
	m.checkWin()
}

func expire[T any](items []T, dt float64, life func(T) *float64) []T {
	out := items[:0]
	for _, it := range items {
		t := life(it)
		if *t -= dt; *t > 0 {
			out = append(out, it)
		}
	}
	return out
}

func (m *Match) move(p *Player, dt float64) {
	speed := m.Cfg.Speed
	if p.Ghost {
		speed = m.Cfg.GhostSpeed
	}
	start := p.Pos
	if p.brain != nil {
		dx, dy := InputStep(p.botDir.X, p.botDir.Y, speed, dt)
		p.Pos = Move(m.Map, p.Pos, dx, dy, p.Ghost)
	}
	// Up to 3 queued commands per tick absorbs jitter without allowing speed hacks.
	n := min(len(p.cmds), 3)
	for _, c := range p.cmds[:n] {
		dx, dy := InputStep(c.DX, c.DY, speed, dt)
		p.Pos = Move(m.Map, p.Pos, dx, dy, p.Ghost)
		p.LastSeq = c.Seq
	}
	p.cmds = p.cmds[n:]

	if p.living() && p.Lit && p.Pos != start {
		if p.dripT -= dt; p.dripT <= 0 {
			p.dripT = m.Cfg.DripEvery
			m.Drips = append(m.Drips, &Drip{Pos: p.Pos, Color: p.Color, T: m.Cfg.DripTime})
			if len(m.Drips) > 800 {
				m.Drips = m.Drips[1:]
			}
		}
	}
}

// onHour runs at each in-game hour. It reports whether the match ended or
// a meeting started.
func (m *Match) onHour(h int) bool {
	ecto := m.Cfg.EctoPerHour
	if h == 5 {
		ecto *= 2
		for _, p := range m.Players {
			if p.Role == RoleHost {
				p.SnuffCD = 0
			}
		}
		m.toast("3 AM. The Witching Hour: mirrors fog and the dead grow stronger.")
	}
	for _, p := range m.Players {
		if p.Ghost {
			p.Ecto = ecto
		}
	}
	if h >= m.Cfg.NightHours {
		if m.livingGuests() >= 2 {
			m.end(TeamGuests, "Dawn breaks over Ravenscroft Manor. The guests survived the night.")
		} else {
			m.end(TeamManor, "Dawn breaks, but too few guests are left to see it.")
		}
		if m.Cfg.Sandbox {
			m.Clock, m.hour = 0, 0 // the night starts over
		}
		return true
	}
	if h == 2 || h == 4 || h == 6 {
		m.startMeeting("dinner", "", "")
		return true
	}
	return false
}

func (m *Match) updateSnuff(p *Player, dt float64) {
	reset := func() { p.snuffTarget, p.snuffT = "", 0 }
	if !p.SnuffOn || p.Role != RoleHost || !p.living() || !m.graceOver() || p.SnuffCD > 0 {
		reset()
		return
	}
	t := m.byID[p.snuffTarget]
	if t == nil {
		best := m.Cfg.SnuffRange
		for _, q := range m.Players {
			if q.living() && q.Lit && q.Role != RoleHost {
				if d := q.Pos.Dist(p.Pos); d <= best {
					t, best = q, d
				}
			}
		}
		if t == nil {
			return
		}
		p.snuffTarget, p.snuffT = t.ID, 0
	}
	if !t.living() || !t.Lit || t.Pos.Dist(p.Pos) > m.Cfg.SnuffRange+0.4 {
		reset()
		return
	}
	if p.snuffT += dt; p.snuffT >= m.Cfg.SnuffTime {
		t.Lit = false
		t.shock = m.Cfg.SnuffShock
		p.SnuffCD = m.Cfg.SnuffCD
		m.Smoke = append(m.Smoke, &Smoke{Pos: t.Pos, Dir: t.Pos.Sub(p.Pos).Normalized(), T: m.Cfg.SmokeTime})
		m.emit(Event{Kind: "snuffed", To: []string{t.ID}, Text: "Your candle was blown out! Your hands shake too much to relight it for a moment."})
		m.sound("snuff", t.Pos, p.ID, t.ID)
		reset()
	}
}

func (m *Match) updateInteractions(dt float64) {
	hearthHolders := make([]int, len(m.Hearths))
	readers := 0
	for _, p := range m.Players {
		edge := p.Interact && !p.interactWas
		p.interactWas = p.Interact
		if !p.Interact {
			p.edgeUsed = false
		}
		if !p.living() || !p.Interact {
			p.holdKind, p.holdT = "", 0
			continue
		}
		if edge && m.instantInteract(p) {
			p.edgeUsed = true
			if m.Phase != PhasePlay {
				return
			}
		}
		if p.edgeUsed {
			p.holdKind = ""
			continue
		}
		kind, target := m.holdTargetFor(p)
		if kind != p.holdKind || target != p.holdTarget {
			p.holdKind, p.holdTarget, p.holdT = kind, target, 0
		}
		switch kind {
		case HoldRefill:
			p.Wax = math.Min(m.Cfg.StartWax, p.Wax+m.Cfg.RefillPerSec*dt)
		case HoldHearth:
			hearthHolders[target]++
		case HoldSearch:
			p.holdT += dt
			if p.holdT >= m.Cfg.SearchTime {
				s := m.Spots[target]
				s.Searched = true
				p.holdKind, p.edgeUsed = "", true
				if s.HasPage {
					s.HasPage = false
					p.Pages++
					m.toast("You found a page of the will! Bring it to the Chapel altar.", p.ID)
				} else {
					m.toast("Nothing hidden here.", p.ID)
				}
			}
		case HoldRead:
			if p.Team == TeamGuests && p.Lit {
				readers++
			}
		}
	}
	for i, h := range m.Hearths {
		if h.Lit {
			continue
		}
		if hearthHolders[i] >= 2 {
			if h.Relight += dt; h.Relight >= m.Cfg.HearthRelight {
				h.Lit, h.Relight = true, 0
				m.toast("A hearth has been relit")
			}
		} else {
			h.Relight = math.Max(0, h.Relight-dt)
		}
	}
	if readers >= 2 {
		if m.Read += dt; m.Read >= m.Cfg.ReadTime {
			m.end(TeamGuests, "The will is read aloud at the altar. The manor releases its guests.")
			m.Read = 0
		}
	} else {
		m.Read = 0
	}
}

// instantInteract handles the actions that happen on the press of E.
func (m *Match) instantInteract(p *Player) bool {
	if p.Role == RoleHost && p.passCD == 0 {
		for _, pair := range m.Map.Passages {
			for i, end := range pair {
				if end.Dist(p.Pos) <= 0.9 {
					p.Pos = pair[1-i]
					p.passCD = 3
					p.history = nil
					return true
				}
			}
		}
	}
	if !p.Lit && p.Wax > 0 && p.shock == 0 && m.nearFlame(p) {
		p.Lit = true
		return true
	}
	for i, l := range m.Loose {
		if l.Dist(p.Pos) <= m.Cfg.InteractRange {
			m.Loose = slices.Delete(m.Loose, i, i+1)
			p.Pages++
			m.toast("You picked up a page of the will.", p.ID)
			return true
		}
	}
	if p.Pages > 0 && p.Team == TeamGuests && m.Map.Altar.DistTo(p.Pos) <= m.Cfg.InteractRange {
		m.AltarPages += p.Pages
		p.Pages = 0
		if m.AltarPages >= 4 {
			m.toast("All four pages lie on the altar. Two guests must read the will together!")
		} else {
			m.toast(fmt.Sprintf("A page of the will was laid on the altar (%d/4)", m.AltarPages))
		}
		return true
	}
	return false
}

func (m *Match) nearFlame(p *Player) bool {
	for _, h := range m.Hearths {
		if h.Lit && h.Pos.Dist(p.Pos) <= m.Cfg.InteractRange {
			return true
		}
	}
	for _, q := range m.Players {
		if q != p && q.living() && q.Lit && q.Pos.Dist(p.Pos) <= m.Cfg.ShareRange {
			return true
		}
	}
	return false
}

func (m *Match) holdTargetFor(p *Player) (string, int) {
	r := m.Cfg.InteractRange
	for i, h := range m.Hearths {
		if h.Pos.Dist(p.Pos) <= r {
			if !h.Lit {
				return HoldHearth, i
			}
			if p.Lit && p.Wax < m.Cfg.StartWax {
				return HoldRefill, i
			}
		}
	}
	for i, s := range m.Spots {
		if !s.Searched && s.Pos.Dist(p.Pos) <= 1.2 {
			return HoldSearch, i
		}
	}
	if m.AltarPages >= 4 && m.Map.Altar.DistTo(p.Pos) <= 2 {
		return HoldRead, 0
	}
	return "", 0
}

// -------------------------------------------------------------- meetings

func (m *Match) startMeeting(reason, caller, body string) {
	m.Phase = PhaseMeeting
	m.Meeting = &Meeting{Reason: reason, Caller: caller, Body: body, Stage: "gather", T: m.Cfg.Gather}
	seat := 0
	for _, p := range m.Players {
		p.voted, p.vote = false, ""
		p.Interact, p.SnuffOn, p.interactWas = false, false, false
		p.holdKind, p.snuffTarget, p.snuffT = "", "", 0
		p.cmds = p.cmds[:0]
		if p.brain != nil {
			p.brain.reset()
		}
		if p.living() {
			p.Pos = m.Map.Seats[seat%len(m.Map.Seats)]
			p.history = nil
			seat++
		}
	}
	m.Read = 0
}

func (m *Match) updateMeeting(dt float64) {
	mt := m.Meeting
	mt.T -= dt
	if mt.Stage == "vote" && m.allVoted() {
		mt.T = 0
	}
	if mt.T > 0 {
		return
	}
	switch mt.Stage {
	case "gather":
		mt.Stage, mt.T = "discuss", m.Cfg.Discuss
	case "discuss":
		mt.Stage, mt.T = "vote", m.Cfg.Vote
	case "vote":
		mt.Stage, mt.T = "result", m.Cfg.Result
		m.tally()
	case "result":
		m.endMeeting()
	}
}

func (m *Match) allVoted() bool {
	for _, p := range m.Players {
		if p.living() && !p.voted {
			return false
		}
	}
	return true
}

func (m *Match) tally() {
	mt := m.Meeting
	mt.Tally = map[string]int{}
	for _, p := range m.Players {
		if p.living() && p.voted {
			mt.Tally[p.vote]++
		}
	}
	best, top, tie := "", 0, false
	for id, n := range mt.Tally {
		if id == "" {
			continue
		}
		if n > top {
			best, top, tie = id, n, false
		} else if n == top {
			tie = true
		}
	}
	switch {
	case best == "" || tie || top <= mt.Tally[""]:
		mt.Text = "No one is locked in the cellar."
	default:
		mt.Locked = best
		mt.Text = m.byID[best].Name + " is dragged down to the cellar."
	}
}

func (m *Match) endMeeting() {
	mt := m.Meeting
	if t := m.byID[mt.Locked]; t != nil {
		m.die(t, false)
		m.emit(Event{Kind: "locked", To: []string{t.ID}, Text: "You were locked in the cellar. You are now a ghost."})
	}
	m.Bodies = nil
	m.Phase = PhasePlay
	if mt.Reason == "dinner" {
		var lit []*Hearth
		for _, h := range m.Hearths {
			if h.Lit {
				lit = append(lit, h)
			}
		}
		if len(lit) > 0 {
			m.coldHearth(lit[m.rng.Intn(len(lit))])
		}
	}
	m.Meeting = nil
	m.checkWin()
}

// ----------------------------------------------------------------- ending

func (m *Match) livingGuests() int {
	n := 0
	for _, p := range m.Players {
		if p.living() && p.Team == TeamGuests {
			n++
		}
	}
	return n
}

func (m *Match) checkWin() {
	if m.Phase == PhaseEnded {
		return
	}
	hosts := 0
	for _, p := range m.Players {
		if p.living() && p.Role == RoleHost {
			hosts++
		}
	}
	lit := 0
	for _, h := range m.Hearths {
		if h.Lit {
			lit++
		}
	}
	switch {
	case hosts == 0:
		m.end(TeamGuests, "Every Host is locked in the cellar. The manor falls silent.")
	case hosts >= m.livingGuests():
		m.end(TeamManor, "The Host now matches the guests in number. The manor feasts.")
	case lit == 0:
		m.end(TeamManor, "The last hearth went cold. Darkness takes Ravenscroft Manor.")
	}
}

func (m *Match) end(w Team, reason string) {
	if m.Cfg.Sandbox {
		// Say once what would have happened, then play on.
		if reason != m.sandboxEnd {
			m.sandboxEnd = reason
			m.toast("[dev] The match would end here: " + reason)
		}
		return
	}
	m.Phase = PhaseEnded
	m.Winner, m.WinReason = w, reason
	m.Meeting = nil
}
