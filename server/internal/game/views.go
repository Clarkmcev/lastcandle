package game

import "math"

// What each client is sent. Every view is filtered by what that player can
// perceive, so a modified client cannot reveal the Host.

type MapView struct {
	W        int      `json:"w"`
	H        int      `json:"h"`
	Rows     []string `json:"rows"`
	Rooms    []Room   `json:"rooms"`
	Hearths  []Vec    `json:"hearths"`
	Mirrors  []Vec    `json:"mirrors"`
	Spots    []Vec    `json:"spots"`
	Passages [][2]Vec `json:"passages,omitempty"`
	Switches []Switch `json:"switches"`
	Altar    Rect     `json:"altar"`
	Table    Rect     `json:"table"`
}

type StartView struct {
	T      string        `json:"t"`
	Map    MapView       `json:"map"`
	Role   Role          `json:"role"`
	Team   Team          `json:"team"`
	Roster []RosterEntry `json:"roster"`
	Words  []string      `json:"words"`
	Config ClientConfig  `json:"config"`
}

type RosterEntry struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Color string `json:"color"`
}

// ClientConfig carries the values the client needs for prediction and HUD.
type ClientConfig struct {
	Tick         float64 `json:"tick"`
	Speed        float64 `json:"speed"`
	GhostSpeed   float64 `json:"ghostSpeed"`
	HearthRadius float64 `json:"hearthRadius"`
	SnuffTime    float64 `json:"snuffTime"`
	SearchTime   float64 `json:"searchTime"`
	ReadTime     float64 `json:"readTime"`
	Relight      float64 `json:"relight"`
	StartWax     float64 `json:"startWax"`
}

// ClientConfig is what the client needs of the match's current rules. It is
// sent again when the rules change during a match.
func (m *Match) ClientConfig() ClientConfig {
	return ClientConfig{
		Tick: m.Cfg.Tick, Speed: m.Cfg.Speed, GhostSpeed: m.Cfg.GhostSpeed,
		HearthRadius: m.Cfg.HearthRadius, SnuffTime: m.Cfg.SnuffTime,
		SearchTime: m.Cfg.SearchTime, ReadTime: m.Cfg.ReadTime,
		Relight: m.Cfg.HearthRelight, StartWax: m.Cfg.StartWax,
	}
}

type PlayerView struct {
	ID     string  `json:"id"`
	X      float64 `json:"x"`
	Y      float64 `json:"y"`
	Lit    bool    `json:"lit,omitempty"`
	Radius float64 `json:"r"`
	Ghost  bool    `json:"ghost,omitempty"`
}

type YouView struct {
	X       float64 `json:"x"`
	Y       float64 `json:"y"`
	Alive   bool    `json:"alive"`
	Ghost   bool    `json:"ghost"`
	Lit     bool    `json:"lit"`
	Wax     float64 `json:"wax"`
	Radius  float64 `json:"r"`
	Pages   int     `json:"pages"`
	Team    Team    `json:"team"`
	SnuffCD float64 `json:"snuffCD"`
	KillCD  float64 `json:"killCD"`
	SabCD   float64 `json:"sabCD"`
	Ecto    int     `json:"ecto"`
	Seance  bool    `json:"seance"`
	Shaken  bool    `json:"shaken,omitempty"` // just snuffed, cannot relight yet
	Hold    string  `json:"hold,omitempty"`
	HoldP   float64 `json:"holdP,omitempty"`
	SnuffP  float64 `json:"snuffP,omitempty"`
	Room    string  `json:"room"`
	Mirror  int     `json:"mirror"` // index of the mirror you stand at, or -1
}

type BodyView struct {
	ID string  `json:"id"`
	X  float64 `json:"x"`
	Y  float64 `json:"y"`
}

type SmokeView struct {
	X  float64 `json:"x"`
	Y  float64 `json:"y"`
	DX float64 `json:"dx"`
	DY float64 `json:"dy"`
	A  float64 `json:"a"` // remaining life, 0..1
}

type DripView struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
	C string  `json:"c"`
	A float64 `json:"a"`
}

type HearthView struct {
	Lit bool    `json:"lit"`
	P   float64 `json:"p,omitempty"` // relight progress, 0..1
}

type SpotView struct {
	I        int  `json:"i"`
	Searched bool `json:"s,omitempty"`
}

type MirrorView struct {
	I    int          `json:"i"`
	Room int          `json:"room"`
	Refl []PlayerView `json:"refl"`
	Word string       `json:"word,omitempty"`
}

type MeetingView struct {
	Reason string         `json:"reason"`
	Caller string         `json:"caller,omitempty"`
	Body   string         `json:"body,omitempty"`
	Stage  string         `json:"stage"`
	T      float64        `json:"t"`
	Voted  []string       `json:"voted"`
	You    string         `json:"you,omitempty"` // your vote, "" = skip
	Tally  map[string]int `json:"tally,omitempty"`
	Locked string         `json:"locked,omitempty"`
	Text   string         `json:"text,omitempty"`
}

type Snapshot struct {
	T          string       `json:"t"`
	Ack        int          `json:"ack"`
	Phase      Phase        `json:"phase"`
	Hour       int          `json:"hour"`
	Witching   bool         `json:"witching,omitempty"`
	Minute     int          `json:"minute"`
	Grace      bool         `json:"grace"`
	You        YouView      `json:"you"`
	Players    []PlayerView `json:"players"`
	Bodies     []BodyView   `json:"bodies"`
	Smoke      []SmokeView  `json:"smoke"`
	Drips      []DripView   `json:"drips"`
	Hearths    []HearthView `json:"hearths"`
	Lamps      []bool       `json:"lamps"` // per switch: its room is lit
	Spots      []SpotView   `json:"spots"`
	Loose      []Vec        `json:"loose"`
	AltarPages int          `json:"altarPages"`
	Read       float64      `json:"read"`
	Mirror     *MirrorView  `json:"mirror,omitempty"`
	Meeting    *MeetingView `json:"meeting,omitempty"`
	Allies     []string     `json:"allies,omitempty"`
}

type EndView struct {
	T      string      `json:"t"`
	Winner Team        `json:"winner"`
	Reason string      `json:"reason"`
	Roles  []EndPlayer `json:"roles"`
}

type EndPlayer struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Color    string `json:"color"`
	Role     Role   `json:"role"`
	Restless bool   `json:"restless,omitempty"`
	Alive    bool   `json:"alive"`
}

func (m *Match) StartFor(id string) StartView {
	p := m.byID[id]
	mv := MapView{
		W: m.Map.W, H: m.Map.H, Rows: m.Map.Rows(), Rooms: m.Map.Rooms,
		Hearths: m.Map.Hearths, Mirrors: m.Map.Mirrors, Spots: m.Map.Spots,
		Altar: m.Map.Altar, Table: m.Map.Table, Switches: m.Map.Switches,
	}
	if p.Role == RoleHost {
		mv.Passages = m.Map.Passages
	}
	sv := StartView{
		T: "start", Map: mv, Role: p.Role, Team: p.Team, Words: MirrorWords,
		Config: m.ClientConfig(),
	}
	for _, q := range m.Players {
		sv.Roster = append(sv.Roster, RosterEntry{q.ID, q.Name, q.Color})
	}
	return sv
}

func round2(v float64) float64 { return math.Round(v*100) / 100 }

func (m *Match) view(q *Player) PlayerView {
	return PlayerView{ID: q.ID, X: round2(q.Pos.X), Y: round2(q.Pos.Y), Lit: q.living() && q.Lit, Radius: round2(m.Radius(q)), Ghost: q.Ghost}
}

func (m *Match) SnapshotFor(id string) Snapshot {
	p := m.byID[id]
	hour, minute := m.ClockFace()
	s := Snapshot{
		T: "snap", Ack: p.LastSeq, Phase: m.Phase, Hour: hour, Minute: minute, Witching: m.Witching(),
		Grace: !m.graceOver(), AltarPages: m.AltarPages, Read: m.Read / m.Cfg.ReadTime,
		Players: []PlayerView{}, Bodies: []BodyView{}, Smoke: []SmokeView{}, Drips: []DripView{},
		Spots: []SpotView{}, Loose: []Vec{},
	}
	room := ""
	if r := m.Map.RoomAt(p.Pos); r >= 0 {
		room = m.Map.Rooms[r].Name
	}
	s.You = YouView{
		X: p.Pos.X, Y: p.Pos.Y, Alive: p.Alive, Ghost: p.Ghost, Lit: p.living() && p.Lit,
		Wax: math.Round(p.Wax), Radius: round2(m.Radius(p)), Pages: p.Pages, Team: p.Team,
		SnuffCD: math.Ceil(p.SnuffCD), KillCD: math.Ceil(p.KillCD), SabCD: math.Ceil(p.SabCD),
		Ecto: p.Ecto, Seance: p.Seance, Shaken: p.shock > 0, Hold: p.holdKind, Room: room, Mirror: m.nearMirror(p.Pos),
	}
	switch p.holdKind {
	case HoldSearch:
		s.You.HoldP = p.holdT / m.Cfg.SearchTime
	case HoldRefill:
		s.You.HoldP = p.Wax / m.Cfg.StartWax
	case HoldHearth:
		s.You.HoldP = m.Hearths[p.holdTarget].Relight / m.Cfg.HearthRelight
	case HoldRead:
		s.You.HoldP = m.Read / m.Cfg.ReadTime
	}
	if p.snuffTarget != "" {
		s.You.SnuffP = p.snuffT / m.Cfg.SnuffTime
	}
	if p.Role == RoleHost || p.Restless {
		for _, q := range m.Players {
			if q.Role == RoleHost {
				s.Allies = append(s.Allies, q.ID)
			}
		}
	}

	meeting := m.Phase == PhaseMeeting
	for _, q := range m.Players {
		if q == p {
			continue
		}
		if (meeting && q.living() && !p.Ghost) || m.canSee(p, q) {
			s.Players = append(s.Players, m.view(q))
		}
	}
	for _, b := range m.Bodies {
		if m.canSeePoint(p, b.Pos, false) {
			s.Bodies = append(s.Bodies, BodyView{b.ID, round2(b.Pos.X), round2(b.Pos.Y)})
		}
	}
	own := m.Radius(p) + 0.3
	near := func(pos Vec) bool {
		return p.Ghost || (p.Pos.Dist(pos) <= own && m.Map.LineOfSight(p.Pos, pos))
	}
	for _, sm := range m.Smoke {
		if near(sm.Pos) {
			s.Smoke = append(s.Smoke, SmokeView{round2(sm.Pos.X), round2(sm.Pos.Y), round2(sm.Dir.X), round2(sm.Dir.Y), round2(sm.T / m.Cfg.SmokeTime)})
		}
	}
	for _, d := range m.Drips {
		if near(d.Pos) {
			s.Drips = append(s.Drips, DripView{round2(d.Pos.X), round2(d.Pos.Y), d.Color, round2(d.T / m.Cfg.DripTime)})
		}
	}
	for i, sp := range m.Spots {
		if near(sp.Pos) {
			s.Spots = append(s.Spots, SpotView{i, sp.Searched})
		}
	}
	for _, l := range m.Loose {
		if near(l) {
			s.Loose = append(s.Loose, l)
		}
	}
	for _, t := range m.Lamps {
		s.Lamps = append(s.Lamps, t > 0)
	}
	for _, h := range m.Hearths {
		s.Hearths = append(s.Hearths, HearthView{h.Lit, round2(h.Relight / m.Cfg.HearthRelight)})
	}

	if mi := s.You.Mirror; mi >= 0 && !meeting {
		mp := m.Map.Mirrors[mi]
		mv := &MirrorView{I: mi, Room: m.Map.RoomAt(mp), Refl: []PlayerView{}}
		if w := m.words[mi]; w != nil {
			mv.Word = w.Word
		}
		if m.Witching() && mv.Word == "" {
			mv.Word = "…"
		}
		for _, q := range m.Players {
			pos := q.Pos
			// The Host's reflection lags half a second behind: the one hard tell.
			if q.Role == RoleHost && len(q.history) > 0 {
				pos = q.history[0]
			}
			if m.Map.RoomAt(pos) == mv.Room {
				v := m.view(q)
				v.X, v.Y = round2(pos.X), round2(pos.Y)
				mv.Refl = append(mv.Refl, v)
			}
		}
		s.Mirror = mv
	}

	if mt := m.Meeting; mt != nil {
		mv := &MeetingView{
			Reason: mt.Reason, Caller: mt.Caller, Body: mt.Body, Stage: mt.Stage,
			T: math.Ceil(mt.T), Voted: []string{}, Locked: mt.Locked, Text: mt.Text,
		}
		for _, q := range m.Players {
			if q.voted {
				mv.Voted = append(mv.Voted, q.ID)
			}
		}
		if p.voted {
			mv.You = p.vote
			if p.vote == "" {
				mv.You = "skip"
			}
		}
		if mt.Stage == "result" {
			mv.Tally = mt.Tally
		}
		s.Meeting = mv
	}
	return s
}

func (m *Match) EndView() EndView {
	ev := EndView{T: "end", Winner: m.Winner, Reason: m.WinReason}
	for _, p := range m.Players {
		ev.Roles = append(ev.Roles, EndPlayer{p.ID, p.Name, p.Color, p.Role, p.Restless, p.living()})
	}
	return ev
}
