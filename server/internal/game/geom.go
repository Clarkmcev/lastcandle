package game

import "math"

type Vec struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
}

func (a Vec) Add(b Vec) Vec       { return Vec{a.X + b.X, a.Y + b.Y} }
func (a Vec) Sub(b Vec) Vec       { return Vec{a.X - b.X, a.Y - b.Y} }
func (a Vec) Scale(s float64) Vec { return Vec{a.X * s, a.Y * s} }
func (a Vec) Len() float64        { return math.Sqrt(a.X*a.X + a.Y*a.Y) }
func (a Vec) Dist(b Vec) float64  { return a.Sub(b).Len() }
func (a Vec) Normalized() Vec {
	l := a.Len()
	if l == 0 {
		return Vec{}
	}
	return Vec{a.X / l, a.Y / l}
}

// BodyRadius is the collision radius of a character, in tiles.
const BodyRadius = 0.3

// Move is the shared movement rule. client/src/movement.ts implements the
// same steps in the same order so client prediction matches the server.
func Move(m *Map, p Vec, dx, dy float64, ghost bool) Vec {
	nx := p.X + dx
	if ghost || !m.blocked(nx, p.Y) {
		p.X = nx
	}
	ny := p.Y + dy
	if ghost || !m.blocked(p.X, ny) {
		p.Y = ny
	}
	p.X = math.Min(math.Max(p.X, 0.5), float64(m.W)-0.5)
	p.Y = math.Min(math.Max(p.Y, 0.5), float64(m.H)-0.5)
	return p
}

// InputStep turns a raw input direction into one tick of movement.
func InputStep(dx, dy, speed, dt float64) (float64, float64) {
	l := math.Sqrt(dx*dx + dy*dy)
	if l == 0 {
		return 0, 0
	}
	if l > 1 {
		dx, dy = dx/l, dy/l
	}
	return dx * speed * dt, dy * speed * dt
}

func (m *Map) blocked(x, y float64) bool {
	x0, x1 := int(math.Floor(x-BodyRadius)), int(math.Floor(x+BodyRadius))
	y0, y1 := int(math.Floor(y-BodyRadius)), int(math.Floor(y+BodyRadius))
	for ty := y0; ty <= y1; ty++ {
		for tx := x0; tx <= x1; tx++ {
			if m.SolidAt(tx, ty) {
				return true
			}
		}
	}
	return false
}

// LineOfSight reports whether no wall stands between a and b.
func (m *Map) LineOfSight(a, b Vec) bool {
	d := b.Sub(a)
	steps := int(d.Len()/0.2) + 1
	for i := 1; i < steps; i++ {
		t := float64(i) / float64(steps)
		if m.OpaqueAt(int(math.Floor(a.X+d.X*t)), int(math.Floor(a.Y+d.Y*t))) {
			return false
		}
	}
	return true
}
