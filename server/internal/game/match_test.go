package game

import (
	"fmt"
	"testing"
)

func seats(n int) []Seat {
	var s []Seat
	for i := 0; i < n; i++ {
		s = append(s, Seat{ID: fmt.Sprintf("p%d", i), Name: fmt.Sprintf("P%d", i), Color: "#fff"})
	}
	return s
}

// newTestMatch returns a match with the first player as the only Host.
func newTestMatch(t *testing.T, n int) (*Match, *Player, []*Player) {
	t.Helper()
	m := NewMatch(DefaultConfig(), seats(n), 1)
	var host *Player
	var guests []*Player
	for _, p := range m.Players {
		p.Role, p.Team = RoleGuest, TeamGuests
	}
	host = m.Players[0]
	host.Role, host.Team = RoleHost, TeamManor
	guests = m.Players[1:]
	m.Clock = m.Cfg.Grace + 1
	m.hour = m.Hour()
	host.KillCD, host.SnuffCD, host.SabCD = 0, 0, 0
	return m, host, guests
}

// darkSpot is a floor tile in the Cellar, far from every hearth.
var darkSpot = Vec{40.5, 38.5}

func TestEveryRoomAndObjectIsReachable(t *testing.T) {
	mp := NewManor()
	for _, r := range mp.Rooms {
		goal := tileCenter((r.X0+r.X1)/2, (r.Y0+r.Y1)/2)
		if mp.SolidAt(int(goal.X), int(goal.Y)) {
			goal = tileCenter(r.X0, r.Y1)
		}
		if mp.Path(mp.Spawn, goal) == nil {
			t.Errorf("room %s unreachable", r.Name)
		}
	}
	for i, h := range mp.Hearths {
		if mp.Path(mp.Spawn, h) == nil {
			t.Errorf("hearth %d unreachable", i)
		}
	}
	for i, s := range mp.Spots {
		if mp.SolidAt(int(s.X), int(s.Y)) || mp.Path(mp.Spawn, s) == nil {
			t.Errorf("page spot %d unreachable", i)
		}
	}
	for _, s := range mp.Seats {
		if mp.SolidAt(int(s.X), int(s.Y)) {
			t.Errorf("seat %v is solid", s)
		}
	}
	if mp.RoomAt(darkSpot) != 9 {
		t.Fatalf("dark spot should be in the cellar")
	}
}

func TestMoveStopsAtWalls(t *testing.T) {
	mp := NewManor()
	p := Vec{2, 2}
	for i := 0; i < 100; i++ {
		p = Move(mp, p, -0.2, 0, false)
	}
	if p.X < 1+BodyRadius-1e-9 {
		t.Fatalf("walked into the wall: %v", p)
	}
	g := Move(mp, Vec{1.4, 2}, -1, 0, true)
	if g.X >= 1 {
		t.Fatalf("ghost should pass through walls: %v", g)
	}
}

func TestSnuffThenKillInTheDark(t *testing.T) {
	m, host, guests := newTestMatch(t, 5)
	victim := guests[0]
	victim.Pos = darkSpot
	host.Pos = darkSpot.Add(Vec{0.8, 0})
	for _, g := range guests[1:] {
		g.Pos = m.Map.Spawn
	}

	if msg := m.Press(host.ID, "kill"); msg == "" {
		t.Fatal("kill should fail while the victim's candle is lit")
	}
	m.SetHold(host.ID, "snuff", true)
	for i := 0; i < int(m.Cfg.SnuffTime/m.Cfg.Tick)+2; i++ {
		m.Tick()
	}
	if victim.Lit {
		t.Fatal("victim's candle should be snuffed")
	}
	// The Host's own candle is right there, but the victim's hands shake.
	m.SetHold(victim.ID, "interact", true)
	m.Tick()
	if victim.Lit {
		t.Fatal("a snuffed guest should not relight straight away")
	}
	m.SetHold(victim.ID, "interact", false)
	if len(m.Smoke) != 1 {
		t.Fatalf("snuff should leave smoke, got %d", len(m.Smoke))
	}
	if msg := m.Press(host.ID, "kill"); msg != "" {
		t.Fatalf("kill failed: %s", msg)
	}
	if victim.living() || !victim.Ghost || len(m.Bodies) != 1 {
		t.Fatal("victim should be a ghost with a body left behind")
	}
}

func TestNoKillInsideAnotherCandle(t *testing.T) {
	m, host, guests := newTestMatch(t, 5)
	victim, witness := guests[0], guests[1]
	victim.Pos, victim.Lit = darkSpot, false
	host.Pos = darkSpot.Add(Vec{0.8, 0})
	witness.Pos = darkSpot.Add(Vec{-2, 0})
	if msg := m.Press(host.ID, "kill"); msg == "" {
		t.Fatal("kill should fail inside a witness's candlelight")
	}
	witness.Pos = m.Map.Spawn
	if msg := m.Press(host.ID, "kill"); msg != "" {
		t.Fatalf("kill should work once the witness leaves: %s", msg)
	}
}

func TestBodyReportVoteAndCellar(t *testing.T) {
	m, host, guests := newTestMatch(t, 5)
	victim := guests[0]
	victim.Pos, victim.Lit = darkSpot, false
	host.Pos = darkSpot.Add(Vec{0.5, 0})
	for _, g := range guests[1:] {
		g.Pos = m.Map.Spawn
	}
	if msg := m.Press(host.ID, "kill"); msg != "" {
		t.Fatal(msg)
	}
	reporter := guests[1]
	reporter.Pos = darkSpot.Add(Vec{0, 1})
	if msg := m.Press(reporter.ID, "report"); msg != "" {
		t.Fatal(msg)
	}
	if m.Phase != PhaseMeeting || m.Meeting.Reason != "body" {
		t.Fatal("report should start a meeting")
	}
	for m.Meeting.Stage != "vote" {
		m.Tick()
	}
	for _, p := range m.Players {
		m.Vote(p.ID, host.ID)
	}
	for m.Phase == PhaseMeeting {
		m.Tick()
	}
	if m.Phase != PhaseEnded || m.Winner != TeamGuests {
		t.Fatalf("locking the only Host should win for guests, got %s %s", m.Phase, m.Winner)
	}
}

func TestTiedVoteLocksNobody(t *testing.T) {
	m, _, guests := newTestMatch(t, 5)
	m.startMeeting("seance", guests[0].ID, "")
	for m.Meeting.Stage != "vote" {
		m.Tick()
	}
	m.Vote(m.Players[0].ID, guests[0].ID)
	m.Vote(m.Players[1].ID, guests[1].ID)
	for m.Meeting.Stage == "vote" {
		m.Tick()
	}
	if m.Meeting.Locked != "" {
		t.Fatalf("tie should lock nobody, locked %s", m.Meeting.Locked)
	}
}

func TestHostParityWins(t *testing.T) {
	m, _, guests := newTestMatch(t, 3)
	m.die(guests[0], true)
	m.checkWin()
	if m.Phase != PhaseEnded || m.Winner != TeamManor {
		t.Fatal("one Host and one guest left should end the match for the manor")
	}
}

func TestDarknessWins(t *testing.T) {
	m, _, _ := newTestMatch(t, 5)
	for _, h := range m.Hearths {
		h.Lit = false
	}
	m.Tick()
	if m.Winner != TeamManor {
		t.Fatal("all hearths cold should win for the manor")
	}
}

func TestDinnerAtMidnightAndDawn(t *testing.T) {
	m, _, _ := newTestMatch(t, 5)
	m.Cfg.HourSeconds = 2
	m.Clock, m.hour = 0, 0
	for m.Phase == PhasePlay {
		m.Tick()
	}
	if m.Meeting == nil || m.Meeting.Reason != "dinner" || m.Hour() != 2 {
		t.Fatal("first dinner should start at midnight")
	}
	for range 100000 {
		if m.Phase == PhaseMeeting {
			m.Meeting.T = 0
		}
		for _, h := range m.Hearths {
			h.Lit = true
		}
		m.Tick()
		if m.Phase == PhaseEnded {
			break
		}
	}
	if m.Winner != TeamGuests || m.Hour() != 8 {
		t.Fatalf("guests should win at dawn, got %s at hour %d", m.Winner, m.Hour())
	}
}

func TestWillReadingNeedsTwoGuests(t *testing.T) {
	m, _, guests := newTestMatch(t, 5)
	altar := m.Map.Altar.Center().Add(Vec{0, 1.2})
	a, b := guests[0], guests[1]
	a.Pos, b.Pos = altar, altar.Add(Vec{0.6, 0})
	a.Pages = 4
	m.SetHold(a.ID, "interact", true)
	m.Tick()
	if m.AltarPages != 4 {
		t.Fatalf("pages should be on the altar, got %d", m.AltarPages)
	}
	m.SetHold(a.ID, "interact", false)
	m.Tick()
	m.SetHold(a.ID, "interact", true)
	for range 40 {
		m.Tick()
	}
	if m.Read != 0 {
		t.Fatal("one reader should not progress")
	}
	m.SetHold(b.ID, "interact", true)
	for i := 0; i < int(m.Cfg.ReadTime/m.Cfg.Tick)+2 && m.Phase == PhasePlay; i++ {
		m.Tick()
	}
	if m.Winner != TeamGuests {
		t.Fatal("two readers should finish the will")
	}
}

func TestHearthRefillAndRelight(t *testing.T) {
	m, _, guests := newTestMatch(t, 5)
	h := m.Hearths[0]
	g := guests[0]
	g.Pos = h.Pos.Add(Vec{0, 1})
	g.Wax, g.Lit = 20, false
	m.SetHold(g.ID, "interact", true)
	m.Tick()
	if !g.Lit {
		t.Fatal("pressing E at a lit hearth should relight the candle")
	}
	m.SetHold(g.ID, "interact", false)
	m.Tick()
	m.SetHold(g.ID, "interact", true)
	for range 20 {
		m.Tick()
	}
	if g.Wax < 25 {
		t.Fatalf("holding E should refill wax, got %.1f", g.Wax)
	}

	m.coldHearth(h)
	g2 := guests[1]
	g2.Pos = h.Pos.Add(Vec{1, 1})
	m.SetHold(g2.ID, "interact", true)
	for i := 0; i < int(m.Cfg.HearthRelight/m.Cfg.Tick)+2; i++ {
		m.Tick()
	}
	if !h.Lit {
		t.Fatal("two players holding E should relight a cold hearth")
	}
}

func TestSnapshotHidesPlayersInTheDark(t *testing.T) {
	m, host, guests := newTestMatch(t, 5)
	viewer := guests[0]
	viewer.Pos = m.Map.Spawn
	host.Pos, host.Lit = darkSpot, false
	s := m.SnapshotFor(viewer.ID)
	for _, pv := range s.Players {
		if pv.ID == host.ID {
			t.Fatal("an unlit player far away must not be sent")
		}
	}
	if len(s.Allies) != 0 {
		t.Fatal("guests must not learn who the Host is")
	}
	if hs := m.SnapshotFor(host.ID); len(hs.Allies) != 1 {
		t.Fatal("the Host should know their allies")
	}
}

func TestMirrorShowsHostLagging(t *testing.T) {
	m, host, guests := newTestMatch(t, 5)
	mirror := m.Map.Mirrors[0] // Library
	g := guests[0]
	g.Pos = mirror.Add(Vec{0, 1.5})
	host.Pos = Vec{6, 6}
	for range 15 {
		m.Tick()
	}
	host.cmds = nil
	for i := range 5 {
		m.QueueCmd(host.ID, Cmd{Seq: 100 + i, DX: 1})
		m.Tick()
	}
	s := m.SnapshotFor(g.ID)
	if s.Mirror == nil {
		t.Fatal("standing at a mirror should show a reflection")
	}
	for _, r := range s.Mirror.Refl {
		if r.ID == host.ID && r.X >= host.Pos.X-0.1 {
			t.Fatalf("Host reflection should lag: reflection %.2f, real %.2f", r.X, host.Pos.X)
		}
	}
}

func TestBotsPlayWholeMatches(t *testing.T) {
	for seed := int64(1); seed <= 6; seed++ {
		cfg := DefaultConfig()
		cfg.HourSeconds, cfg.Discuss, cfg.Vote = 20, 2, 3
		var s []Seat
		for i := 0; i < 8; i++ {
			s = append(s, Seat{ID: fmt.Sprintf("b%d", i), Name: fmt.Sprintf("Bot%d", i), Color: "#abc", Bot: true})
		}
		m := NewMatch(cfg, s, seed)
		ticks := 0
		for m.Phase != PhaseEnded && ticks < 200000 {
			m.Tick()
			for _, p := range m.Players {
				m.SnapshotFor(p.ID)
			}
			m.TakeEvents()
			ticks++
		}
		if m.Phase != PhaseEnded {
			t.Fatalf("seed %d: match never ended", seed)
		}
		t.Logf("seed %d: %s won after %.0fs with %d guest deaths: %s", seed, m.Winner, float64(ticks)*cfg.Tick, m.deaths, m.WinReason)
	}
}
