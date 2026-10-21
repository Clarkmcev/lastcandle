package game

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
)

// Config holds every tuning value from the design doc's Balancing section.
// Times are in seconds, distances in tiles.
type Config struct {
	Tick float64 // simulation step

	HourSeconds float64 // real time per in-game hour
	NightHours  int     // 10 PM to 6 AM
	Grace       float64 // no snuffing or sabotage at the start

	StartWax     float64
	BurnPerSec   float64
	RefillPerSec float64
	FullRadius   float64 // candle light radius above half wax
	OutRadius    float64 // what you see with no candle
	HearthRadius float64
	ShareRange   float64
	ShareBonus   float64

	Speed      float64 // tiles per second
	GhostSpeed float64

	// Floor tiles inside each side room of the manor. The middle column of
	// rooms is 2 tiles wider and the cellar 2 tiles shorter.
	RoomWidth  int
	RoomHeight int

	SnuffRange float64
	SnuffTime  float64
	SnuffCD    float64
	SnuffShock float64 // how long a snuffed guest cannot relight
	KillRange  float64
	KillCD     float64
	SabCD      float64
	DraftWax   float64

	ReportRange   float64
	InteractRange float64
	HearthRelight float64 // 2-player relight time for a cold hearth
	SearchTime    float64
	ReadTime      float64
	SeanceCost    float64

	Gather  float64
	Discuss float64
	Vote    float64
	Result  float64

	EctoPerHour    int
	RestlessChance float64
	MirrorLagTicks int
	MirrorRange    float64
	MirrorWordTime float64
	KnockRange     float64
	HearRange      float64 // how far away a snuff or a kill can be heard
	SmokeTime      float64
	DripTime       float64
	DripEvery      float64
	FarCandleSight float64 // a lit candle can be seen from this far in the dark

	// Sandbox is developer mode: the match never ends, so one person can
	// walk the manor and try every action alone.
	Sandbox bool `json:"-"`
}

func DefaultConfig() Config {
	return Config{
		Tick:           0.05,
		HourSeconds:    60,
		NightHours:     8,
		Grace:          20,
		StartWax:       100,
		BurnPerSec:     0.5,
		RefillPerSec:   10,
		FullRadius:     4,
		OutRadius:      1,
		HearthRadius:   5,
		ShareRange:     1.5,
		ShareBonus:     1.3,
		Speed:          4,
		RoomWidth:      BaseRoomWidth,
		RoomHeight:     BaseRoomHeight,
		GhostSpeed:     5,
		SnuffRange:     1.2,
		SnuffTime:      0.6,
		SnuffCD:        25,
		SnuffShock:     3,
		KillRange:      1.2,
		KillCD:         35,
		SabCD:          60,
		DraftWax:       15,
		ReportRange:    1.5,
		InteractRange:  1.6,
		HearthRelight:  8,
		SearchTime:     6,
		ReadTime:       12,
		SeanceCost:     60,
		Gather:         3,
		Discuss:        30,
		Vote:           15,
		Result:         8, // long enough to see what the vote did
		EctoPerHour:    6,
		RestlessChance: 0.25,
		MirrorLagTicks: 10,
		MirrorRange:    2,
		MirrorWordTime: 30,
		KnockRange:     16,
		HearRange:      9,
		SmokeTime:      20,
		DripTime:       45,
		DripEvery:      0.5,
		FarCandleSight: 14,
	}
}

// HostCount follows the "Hosts by lobby size" table.
func HostCount(players int) int {
	if players >= 9 {
		return 2
	}
	return 1
}

// LoadConfig reads a JSON config file over the defaults. Keys are the
// Config field names in camelCase, e.g. {"speed": 5, "roomWidth": 18};
// keys that are left out keep their default.
func LoadConfig(path string) (Config, error) {
	cfg := DefaultConfig()
	b, err := os.ReadFile(path)
	if err != nil {
		return cfg, err
	}
	dec := json.NewDecoder(bytes.NewReader(b))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&cfg); err != nil {
		return cfg, fmt.Errorf("%s: %w", path, err)
	}
	if err := cfg.Validate(); err != nil {
		return cfg, fmt.Errorf("%s: %w", path, err)
	}
	return cfg, nil
}

// Validate rejects values the game cannot run with.
func (c Config) Validate() error {
	switch {
	case c.Speed <= 0 || c.GhostSpeed <= 0:
		return fmt.Errorf("speed and ghostSpeed must be above 0")
	case c.RoomWidth < MinRoomWidth || c.RoomWidth > MaxRoomSize:
		return fmt.Errorf("roomWidth must be %d to %d tiles", MinRoomWidth, MaxRoomSize)
	case c.RoomHeight < MinRoomHeight || c.RoomHeight > MaxRoomSize:
		return fmt.Errorf("roomHeight must be %d to %d tiles", MinRoomHeight, MaxRoomSize)
	case c.Tick <= 0 || c.HourSeconds <= 0:
		return fmt.Errorf("tick and hourSeconds must be above 0")
	}
	return nil
}
