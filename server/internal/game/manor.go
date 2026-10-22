package game

import (
	"fmt"
	"math"
)

// Tile kinds as sent to the client.
const (
	TileWall   = '#'
	TileFloor  = '.'
	TileHearth = 'H'
	TileMirror = 'M'
	TileTable  = 'T'
	TileAltar  = 'A'
)

type Room struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	X0   int    `json:"x0"`
	Y0   int    `json:"y0"`
	X1   int    `json:"x1"`
	Y1   int    `json:"y1"`
}

func (r Room) contains(x, y int) bool { return x >= r.X0 && x <= r.X1 && y >= r.Y0 && y <= r.Y1 }

type Rect struct {
	X0 int `json:"x0"`
	Y0 int `json:"y0"`
	X1 int `json:"x1"`
	Y1 int `json:"y1"`
}

// DistTo is the distance from p to the nearest point of the rect's tiles.
func (r Rect) DistTo(p Vec) float64 {
	cx := math.Max(float64(r.X0), math.Min(p.X, float64(r.X1+1)))
	cy := math.Max(float64(r.Y0), math.Min(p.Y, float64(r.Y1+1)))
	return p.Dist(Vec{cx, cy})
}

func (r Rect) Center() Vec {
	return Vec{float64(r.X0+r.X1+1) / 2, float64(r.Y0+r.Y1+1) / 2}
}

// Switch turns on the lamps of one room. It sits on the floor tile below
// the room's top wall, where the client draws its brass plate.
type Switch struct {
	Pos  Vec `json:"pos"`
	Room int `json:"room"`
}

// Map is the static layout of Ravenscroft Manor.
type Map struct {
	W, H      int
	Tiles     []byte
	Rooms     []Room
	Hearths   []Vec
	Mirrors   []Vec
	Spots     []Vec
	Passages  [][2]Vec
	Switches  []Switch
	Altar     Rect
	Table     Rect
	Spawn     Vec
	Seats     []Vec
	roomIndex []int
}

func (m *Map) in(x, y int) bool { return x >= 0 && y >= 0 && x < m.W && y < m.H }

func (m *Map) SolidAt(x, y int) bool {
	return !m.in(x, y) || m.Tiles[y*m.W+x] != TileFloor
}

func (m *Map) OpaqueAt(x, y int) bool {
	return !m.in(x, y) || m.Tiles[y*m.W+x] == TileWall
}

// RoomAt returns the room index at a position, or -1 in a doorway.
func (m *Map) RoomAt(p Vec) int {
	x, y := int(math.Floor(p.X)), int(math.Floor(p.Y))
	if !m.in(x, y) {
		return -1
	}
	return m.roomIndex[y*m.W+x]
}

// Rows returns the tile grid as strings, one per row.
func (m *Map) Rows() []string {
	rows := make([]string, m.H)
	for y := 0; y < m.H; y++ {
		rows[y] = string(m.Tiles[y*m.W : (y+1)*m.W])
	}
	return rows
}

func tileCenter(x, y int) Vec { return Vec{float64(x) + 0.5, float64(y) + 0.5} }

// The design doc's floor plan is drawn with 14×10 side rooms. Every
// position below is in that base plan; BuildManor moves it to fit the
// configured room size.
const (
	BaseRoomWidth  = 14
	BaseRoomHeight = 10
	MinRoomWidth   = 10
	MinRoomHeight  = 8
	// The client bakes the whole floor into one texture at 32 px a tile;
	// 30-tile rooms keep it under 4096 px, the limit on many GPUs.
	MaxRoomSize = 30
)

// NewManor builds the floor plan at its base size.
func NewManor() *Map { return BuildManor(BaseRoomWidth, BaseRoomHeight) }

// roomGrid places the 10 rooms for side rooms of w×h floor tiles: three
// columns (the middle one 2 tiles wider) over four rows (the cellar row 2
// tiles shorter), with one wall tile between them.
func roomGrid(w, h int) (rooms []Room, width, height int) {
	cols := []int{w, w + 2, w}
	rows := []int{h, h, h, h - 2}
	starts := func(sizes []int) []int {
		s := []int{1}
		for _, n := range sizes[:len(sizes)-1] {
			s = append(s, s[len(s)-1]+n+1)
		}
		return s
	}
	xs, ys := starts(cols), starts(rows)
	for _, r := range []struct {
		id, name string
		col, row int
	}{
		{"library", "Library", 0, 0}, {"chapel", "Chapel", 1, 0}, {"nursery", "Nursery", 2, 0},
		{"study", "Study", 0, 1}, {"dining", "Dining Hall", 1, 1}, {"ballroom", "Ballroom", 2, 1},
		{"conservatory", "Conservatory", 0, 2}, {"entrance", "Entrance Hall", 1, 2}, {"kitchen", "Kitchen", 2, 2},
		{"cellar", "Cellar", 2, 3},
	} {
		x0, y0 := xs[r.col], ys[r.row]
		rooms = append(rooms, Room{r.id, r.name, x0, y0, x0 + cols[r.col] - 1, y0 + rows[r.row] - 1})
	}
	return rooms, xs[2] + cols[2] + 1, ys[3] + rows[3] + 1
}

// stretch moves v from [a0, a1] to [b0, b1]: the ends stay on the ends (so
// things against a wall stay there) and the rest keep their proportion.
func stretch(v, a0, a1, b0, b1 int) int {
	switch v {
	case a0:
		return b0
	case a1:
		return b1
	}
	n := b0 + int(math.Round(float64(v-a0)*float64(b1-b0)/float64(a1-a0)))
	return max(b0+1, min(b1-1, n))
}

// BuildManor builds the floor plan with side rooms of w×h floor tiles.
// Callers keep w and h within the Min/Max limits above.
func BuildManor(w, h int) *Map {
	base, _, _ := roomGrid(BaseRoomWidth, BaseRoomHeight)
	rooms, width, height := roomGrid(w, h)
	m := &Map{W: width, H: height, Rooms: rooms}
	m.Tiles = make([]byte, m.W*m.H)
	m.roomIndex = make([]int, m.W*m.H)
	for i := range m.Tiles {
		m.Tiles[i] = TileWall
		m.roomIndex[i] = -1
	}
	set := func(x, y int, t byte) { m.Tiles[y*m.W+x] = t }
	for i, r := range m.Rooms {
		for y := r.Y0; y <= r.Y1; y++ {
			for x := r.X0; x <= r.X1; x++ {
				set(x, y, TileFloor)
				m.roomIndex[y*m.W+x] = i
			}
		}
	}
	room := func(id string) Room {
		for _, r := range m.Rooms {
			if r.ID == id {
				return r
			}
		}
		panic("no room " + id)
	}
	// at moves a tile of the base plan into the same place in its room here.
	at := func(x, y int) (int, int) {
		for i, b := range base {
			if b.contains(x, y) {
				r := m.Rooms[i]
				return stretch(x, b.X0, b.X1, r.X0, r.X1), stretch(y, b.Y0, b.Y1, r.Y0, r.Y1)
			}
		}
		panic(fmt.Sprintf("base tile %d,%d is in no room", x, y))
	}
	center := func(a0, a1 int) int { return (a0 + a1) / 2 }

	// Each door is two tiles wide, centred on the wall the rooms share.
	for _, d := range [][2]string{
		{"library", "chapel"}, {"library", "study"}, {"study", "conservatory"},
		{"study", "dining"}, {"chapel", "dining"}, {"dining", "ballroom"},
		{"dining", "entrance"}, {"conservatory", "entrance"}, {"entrance", "kitchen"},
		{"ballroom", "nursery"}, {"ballroom", "kitchen"}, {"kitchen", "cellar"},
	} {
		a, b := room(d[0]), room(d[1])
		if b.X0 < a.X0 || b.Y0 < a.Y0 {
			a, b = b, a
		}
		if a.X1 < b.X0 { // side by side
			y := center(max(a.Y0, b.Y0), min(a.Y1, b.Y1))
			set(a.X1+1, y, TileFloor)
			set(a.X1+1, y+1, TileFloor)
		} else { // one above the other
			x := center(max(a.X0, b.X0), min(a.X1, b.X1))
			set(x, a.Y1+1, TileFloor)
			set(x+1, a.Y1+1, TileFloor)
		}
	}

	for _, h := range [][2]int{{3, 1}, {1, 19}, {17, 20}, {46, 20}, {2, 32}, {46, 24}} {
		x, y := at(h[0], h[1])
		set(x, y, TileHearth)
		m.Hearths = append(m.Hearths, tileCenter(x, y))
	}
	for _, mi := range [][2]int{{12, 1}, {14, 13}, {31, 2}, {31, 13}, {17, 32}, {46, 5}, {34, 12}, {34, 21}} {
		x, y := at(mi[0], mi[1])
		set(x, y, TileMirror)
		m.Mirrors = append(m.Mirrors, tileCenter(x, y))
	}
	for _, s := range [][2]int{{5, 4}, {10, 8}, {2, 9}, {13, 5}, {6, 14}, {18, 9}, {40, 4}, {8, 30}, {36, 30}, {37, 39}, {44, 36}, {42, 17}} {
		m.Spots = append(m.Spots, tileCenter(at(s[0], s[1])))
	}
	// Lamps in the rooms that have no hearth (the cellar keeps its dark).
	for _, sw := range [][2]int{{29, 1}, {35, 1}, {18, 23}} { // Chapel, Nursery, Entrance Hall
		x, y := at(sw[0], sw[1])
		m.Switches = append(m.Switches, Switch{tileCenter(x, y), m.roomIndex[y*m.W+x]})
	}
	for _, p := range [][4]int{
		{1, 10, 46, 10}, // Library <-> Nursery
		{1, 23, 34, 41}, // Conservatory <-> Cellar
	} {
		ax, ay := at(p[0], p[1])
		bx, by := at(p[2], p[3])
		m.Passages = append(m.Passages, [2]Vec{tileCenter(ax, ay), tileCenter(bx, by)})
	}

	chapel, dining := room("chapel"), room("dining")
	_, altarY := at(23, 3)
	ax := center(chapel.X0, chapel.X1)
	m.Altar = Rect{ax, altarY, ax + 1, altarY}
	tx, ty := center(dining.X0, dining.X1)-2, center(dining.Y0, dining.Y1)-1
	m.Table = Rect{tx, ty, tx + 5, ty + 3}
	for _, r := range []Rect{m.Altar, m.Table} {
		t := byte(TileAltar)
		if r == m.Table {
			t = TileTable
		}
		for y := r.Y0; y <= r.Y1; y++ {
			for x := r.X0; x <= r.X1; x++ {
				set(x, y, t)
			}
		}
	}
	sx, sy := at(24, 28)
	m.Spawn = Vec{float64(sx), float64(sy)}
	for x := m.Table.X0; x <= m.Table.X1; x++ {
		m.Seats = append(m.Seats, tileCenter(x, m.Table.Y0-1), tileCenter(x, m.Table.Y1+1))
	}
	return m
}
