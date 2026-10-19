package game

import "math"

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

// Map is the static layout of Ravenscroft Manor.
type Map struct {
	W, H      int
	Tiles     []byte
	Rooms     []Room
	Hearths   []Vec
	Mirrors   []Vec
	Spots     []Vec
	Passages  [][2]Vec
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

// NewManor builds the 10-room floor plan from the design doc.
func NewManor() *Map {
	m := &Map{W: 48, H: 43}
	m.Tiles = make([]byte, m.W*m.H)
	m.roomIndex = make([]int, m.W*m.H)
	for i := range m.Tiles {
		m.Tiles[i] = TileWall
		m.roomIndex[i] = -1
	}
	m.Rooms = []Room{
		{"library", "Library", 1, 1, 14, 10},
		{"chapel", "Chapel", 16, 1, 31, 10},
		{"nursery", "Nursery", 33, 1, 46, 10},
		{"study", "Study", 1, 12, 14, 21},
		{"dining", "Dining Hall", 16, 12, 31, 21},
		{"ballroom", "Ballroom", 33, 12, 46, 21},
		{"conservatory", "Conservatory", 1, 23, 14, 32},
		{"entrance", "Entrance Hall", 16, 23, 31, 32},
		{"kitchen", "Kitchen", 33, 23, 46, 32},
		{"cellar", "Cellar", 33, 34, 46, 41},
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
	doors := [][4]int{
		{15, 5, 15, 6},   // Library - Chapel
		{7, 11, 8, 11},   // Library - Study
		{7, 22, 8, 22},   // Study - Conservatory
		{15, 16, 15, 17}, // Study - Dining
		{23, 11, 24, 11}, // Chapel - Dining
		{32, 16, 32, 17}, // Dining - Ballroom
		{23, 22, 24, 22}, // Dining - Entrance
		{15, 27, 15, 28}, // Conservatory - Entrance
		{32, 27, 32, 28}, // Entrance - Kitchen
		{39, 11, 40, 11}, // Ballroom - Nursery
		{39, 22, 40, 22}, // Ballroom - Kitchen
		{39, 33, 40, 33}, // Kitchen - Cellar
	}
	for _, d := range doors {
		for y := d[1]; y <= d[3]; y++ {
			for x := d[0]; x <= d[2]; x++ {
				set(x, y, TileFloor)
			}
		}
	}

	for _, h := range [][2]int{{3, 1}, {1, 19}, {17, 20}, {46, 20}, {2, 32}, {46, 24}} {
		set(h[0], h[1], TileHearth)
		m.Hearths = append(m.Hearths, tileCenter(h[0], h[1]))
	}
	for _, mi := range [][2]int{{12, 1}, {14, 13}, {31, 2}, {31, 13}, {17, 32}, {46, 5}, {34, 12}, {34, 21}} {
		set(mi[0], mi[1], TileMirror)
		m.Mirrors = append(m.Mirrors, tileCenter(mi[0], mi[1]))
	}
	for _, s := range [][2]int{{5, 4}, {10, 8}, {2, 9}, {13, 5}, {6, 14}, {18, 9}, {40, 4}, {8, 30}, {36, 30}, {37, 39}, {44, 36}, {42, 17}} {
		m.Spots = append(m.Spots, tileCenter(s[0], s[1]))
	}
	m.Passages = [][2]Vec{
		{tileCenter(1, 10), tileCenter(46, 10)}, // Library <-> Nursery
		{tileCenter(1, 23), tileCenter(34, 41)}, // Conservatory <-> Cellar
	}
	m.Altar = Rect{23, 3, 24, 3}
	m.Table = Rect{21, 15, 26, 18}
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
	m.Spawn = Vec{24, 28}
	for x := 21; x <= 26; x++ {
		m.Seats = append(m.Seats, tileCenter(x, 14), tileCenter(x, 19))
	}
	return m
}
