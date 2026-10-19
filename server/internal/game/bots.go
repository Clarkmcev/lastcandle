package game

import "math"

// brain is the state of a simple bot. Bots fill lobbies for testing: guests
// keep their candle fed, search for pages and report bodies; a Host bot
// stalks lone guests.
type brain struct {
	goal     Vec
	hasGoal  bool
	path     []Vec
	purpose  string // refill, relight, search, hearth, altar, wander, hunt
	target   int
	wait     float64
	repath   float64
	lastPos  Vec
	stuckFor float64
	voteIn   float64
}

func (b *brain) reset() { *b = brain{voteIn: -1} }

func (m *Match) botThink(p *Player, dt float64) {
	b := p.brain
	p.botDir = Vec{}
	if m.Phase == PhaseMeeting {
		m.botVote(p, dt)
		return
	}
	if p.edgeUsed {
		p.Interact = false
	}
	if p.Ghost {
		m.ghostWander(p, dt)
		return
	}
	if !p.living() {
		return
	}
	if p.Role == RoleHost && m.botHunt(p, dt) {
		return
	}
	p.SnuffOn = false
	if p.Role != RoleHost {
		for _, body := range m.Bodies {
			if body.Pos.Dist(p.Pos) <= m.Cfg.ReportRange && m.canSeePoint(p, body.Pos, false) {
				m.report(p)
				return
			}
		}
	}

	switch {
	case !p.Lit && p.Wax > 0:
		m.botGoTo(p, "relight", m.nearestHearth(p.Pos, true))
	case p.Wax < 35 || (b.purpose == "refill" && p.Wax < 95):
		m.botGoTo(p, "refill", m.nearestHearth(p.Pos, true))
	case p.Pages > 0 && p.Team == TeamGuests:
		m.botGoToPos(p, "altar", -1, m.Map.Altar.Center().Add(Vec{0, 1.2}))
	case m.AltarPages >= 4 && p.Team == TeamGuests:
		m.botGoToPos(p, "altar", -1, m.Map.Altar.Center().Add(Vec{0, 1.2}))
	case b.purpose == "" || b.purpose == "relight" || b.purpose == "refill" || b.purpose == "altar":
		m.botPickErrand(p)
	}
	m.botFollow(p, dt)
}

func (m *Match) nearestHearth(pos Vec, lit bool) int {
	best, bi := math.Inf(1), -1
	for i, h := range m.Hearths {
		if h.Lit == lit {
			if d := h.Pos.Dist(pos); d < best {
				best, bi = d, i
			}
		}
	}
	return bi
}

func (m *Match) botGoTo(p *Player, purpose string, hearth int) {
	if hearth < 0 {
		m.botPickErrand(p)
		return
	}
	m.botGoToPos(p, purpose, hearth, m.Hearths[hearth].Pos)
}

func (m *Match) botGoToPos(p *Player, purpose string, target int, pos Vec) {
	b := p.brain
	if b.purpose == purpose && b.target == target && b.hasGoal {
		return
	}
	b.purpose, b.target = purpose, target
	m.botSetGoal(p, pos)
}

func (m *Match) botSetGoal(p *Player, goal Vec) {
	b := p.brain
	b.goal, b.hasGoal = goal, true
	b.path = m.Map.Path(p.Pos, goal)
	b.stuckFor = 0
}

func (m *Match) botPickErrand(p *Player) {
	b := p.brain
	r := m.rng.Float64()
	if r < 0.45 {
		var open []int
		for i, s := range m.Spots {
			if !s.Searched {
				open = append(open, i)
			}
		}
		if len(open) > 0 {
			i := open[m.rng.Intn(len(open))]
			b.purpose, b.target = "search", i
			m.botSetGoal(p, m.Spots[i].Pos)
			return
		}
	}
	if r < 0.65 {
		if i := m.nearestHearth(p.Pos, false); i >= 0 {
			b.purpose, b.target = "hearth", i
			b.wait = 12
			m.botSetGoal(p, m.Hearths[i].Pos)
			return
		}
	}
	b.purpose, b.target = "wander", -1
	b.wait = 1 + m.rng.Float64()*3
	m.botSetGoal(p, m.randomFloor())
}

func (m *Match) randomFloor() Vec {
	for {
		r := m.Map.Rooms[m.rng.Intn(len(m.Map.Rooms))]
		x := r.X0 + m.rng.Intn(r.X1-r.X0+1)
		y := r.Y0 + m.rng.Intn(r.Y1-r.Y0+1)
		if !m.Map.SolidAt(x, y) {
			return tileCenter(x, y)
		}
	}
}

// botFollow walks the path, then holds E or waits at the goal.
func (m *Match) botFollow(p *Player, dt float64) {
	b := p.brain
	if len(b.path) > 0 {
		wp := b.path[0]
		if wp.Dist(p.Pos) < 0.15 {
			b.path = b.path[1:]
		} else {
			p.botDir = wp.Sub(p.Pos).Normalized()
		}
		if p.Pos.Dist(b.lastPos) < 0.02 {
			if b.stuckFor += dt; b.stuckFor > 1.5 {
				b.purpose, b.hasGoal, b.path = "", false, nil
			}
		} else {
			b.stuckFor = 0
		}
		b.lastPos = p.Pos
		p.Interact = false
		return
	}
	switch b.purpose {
	case "relight":
		// Relighting happens on the press, so tap E until it takes.
		p.Interact = !p.Interact
		if p.Lit {
			b.purpose = ""
		}
	case "refill":
		p.Interact = !p.edgeUsed
		if p.Wax >= 95 {
			b.purpose, p.Interact = "", false
		}
	case "search":
		p.Interact = !p.edgeUsed
		if m.Spots[b.target].Searched {
			b.purpose, p.Interact = "", false
		}
	case "altar":
		p.Interact = !p.edgeUsed || p.Pages > 0
		if p.Pages == 0 && m.AltarPages < 4 {
			b.purpose, p.Interact = "", false
		}
	case "hearth":
		p.Interact = true
		if b.wait -= dt; b.wait <= 0 || m.Hearths[b.target].Lit {
			b.purpose, p.Interact = "", false
		}
	default:
		if b.wait -= dt; b.wait <= 0 {
			b.purpose = ""
		}
	}
}

func (m *Match) botHunt(p *Player, dt float64) bool {
	b := p.brain
	if !m.graceOver() {
		return false
	}
	alone := func(t *Player) bool {
		for _, q := range m.Players {
			if q != t && q != p && q.living() && q.Pos.Dist(t.Pos) < 5 {
				return false
			}
		}
		return true
	}
	var prey *Player
	best := 8.0
	for _, q := range m.Players {
		if !q.living() || q.Role == RoleHost || !alone(q) {
			continue
		}
		if q.Lit && p.SnuffCD > 0 {
			continue
		}
		if !q.Lit && p.KillCD > 0 {
			continue
		}
		if d := q.Pos.Dist(p.Pos); d < best && m.Map.LineOfSight(p.Pos, q.Pos) {
			prey, best = q, d
		}
	}
	if prey == nil {
		p.SnuffOn = false
		if b.purpose == "hunt" {
			b.purpose = ""
		}
		return false
	}
	b.purpose = "hunt"
	p.Interact = false
	if !prey.Lit {
		if best <= m.Cfg.KillRange*0.9 {
			m.kill(p)
			return true
		}
	} else if best <= m.Cfg.SnuffRange*0.8 {
		p.SnuffOn = true
		return true
	}
	if b.repath -= dt; b.repath <= 0 || len(b.path) == 0 {
		b.repath = 0.5
		b.path = m.Map.Path(p.Pos, prey.Pos)
	}
	if len(b.path) > 0 && b.path[0].Dist(p.Pos) < 0.15 {
		b.path = b.path[1:]
	}
	if len(b.path) > 0 {
		p.botDir = b.path[0].Sub(p.Pos).Normalized()
	} else {
		p.botDir = prey.Pos.Sub(p.Pos).Normalized()
	}
	return true
}

func (m *Match) ghostWander(p *Player, dt float64) {
	b := p.brain
	if !b.hasGoal || b.goal.Dist(p.Pos) < 0.3 {
		if b.wait -= dt; b.wait > 0 {
			return
		}
		b.goal, b.hasGoal, b.wait = m.randomFloor(), true, 2+m.rng.Float64()*4
	}
	p.botDir = b.goal.Sub(p.Pos).Normalized()
}

func (m *Match) botVote(p *Player, dt float64) {
	b := p.brain
	mt := m.Meeting
	if mt.Stage != "vote" || !p.living() || p.voted {
		b.voteIn = -1
		return
	}
	if b.voteIn < 0 {
		b.voteIn = 1 + m.rng.Float64()*6
	}
	if b.voteIn -= dt; b.voteIn > 0 {
		return
	}
	target := ""
	if m.rng.Float64() < 0.3 {
		var others []string
		for _, q := range m.Players {
			if q != p && q.living() && !(p.Role == RoleHost && q.Role == RoleHost) {
				others = append(others, q.ID)
			}
		}
		if len(others) > 0 {
			target = others[m.rng.Intn(len(others))]
		}
	}
	m.Vote(p.ID, target)
}

// Path finds a walkable route of tile centers from a to b with BFS. When b is
// on a solid tile (a hearth, the altar), it ends next to it.
func (mp *Map) Path(a, b Vec) []Vec {
	sx, sy := int(math.Floor(a.X)), int(math.Floor(a.Y))
	gx, gy := int(math.Floor(b.X)), int(math.Floor(b.Y))
	goal := func(x, y int) bool {
		if !mp.SolidAt(gx, gy) {
			return x == gx && y == gy
		}
		return abs(x-gx)+abs(y-gy) == 1
	}
	prev := make([]int, mp.W*mp.H)
	for i := range prev {
		prev[i] = -2
	}
	start := sy*mp.W + sx
	if !mp.in(sx, sy) {
		return nil
	}
	prev[start] = -1
	queue := []int{start}
	end := -1
	for len(queue) > 0 {
		cur := queue[0]
		queue = queue[1:]
		cx, cy := cur%mp.W, cur/mp.W
		if goal(cx, cy) {
			end = cur
			break
		}
		for _, d := range [4][2]int{{1, 0}, {-1, 0}, {0, 1}, {0, -1}} {
			nx, ny := cx+d[0], cy+d[1]
			if mp.SolidAt(nx, ny) {
				continue
			}
			n := ny*mp.W + nx
			if prev[n] != -2 {
				continue
			}
			prev[n] = cur
			queue = append(queue, n)
		}
	}
	if end < 0 {
		return nil
	}
	var path []Vec
	for c := end; c != start && c >= 0; c = prev[c] {
		path = append([]Vec{tileCenter(c%mp.W, c/mp.W)}, path...)
	}
	return path
}

func abs(v int) int {
	if v < 0 {
		return -v
	}
	return v
}
