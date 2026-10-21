package game

import (
	"fmt"
	"math"
)

// Setting is one game rule the lobby owner can change on the settings page.
// The list below is the only place rules are named for players: the client
// builds its form from it, and the server checks every change against it.
type Setting struct {
	Key   string  `json:"key"`
	Label string  `json:"label"`
	Group string  `json:"group"`
	Unit  string  `json:"unit,omitempty"`
	Min   float64 `json:"min"`
	Max   float64 `json:"max"`
	Step  float64 `json:"step"`
	// Live settings change a match in progress; the rest (the manor's
	// size) wait for the next match.
	Live bool `json:"live"`

	get func(*Config) float64
	set func(*Config, float64)
}

func num(key, label, group, unit string, min, max, step float64, field func(*Config) *float64) Setting {
	return Setting{key, label, group, unit, min, max, step, true,
		func(c *Config) float64 { return *field(c) },
		func(c *Config, v float64) { *field(c) = v }}
}

// layout marks a setting that shapes the manor, so it waits for the next match.
func layout(s Setting) Setting {
	s.Live = false
	return s
}

func whole(key, label, group, unit string, min, max int, field func(*Config) *int) Setting {
	return Setting{key, label, group, unit, float64(min), float64(max), 1, true,
		func(c *Config) float64 { return float64(*field(c)) },
		func(c *Config, v float64) { *field(c) = int(v) }}
}

// Settings are the rules a lobby can change, in the order the page shows them.
var Settings = []Setting{
	num("hourSeconds", "Length of an hour", "The night", "s", 10, 180, 5, func(c *Config) *float64 { return &c.HourSeconds }),
	num("grace", "Grace period at the start", "The night", "s", 0, 60, 5, func(c *Config) *float64 { return &c.Grace }),
	whole("nightHours", "Length of the night", "The night", "h", 2, 12, func(c *Config) *int { return &c.NightHours }),
	whole("witchingHour", "The Witching Hour", "The night", "clock", 1, 11, func(c *Config) *int { return &c.WitchingHour }),
	whole("firstDinner", "First dinner", "Dinner", "clock", 1, 11, func(c *Config) *int { return &c.FirstDinner }),
	whole("dinnerEvery", "Dinner every", "Dinner", "h", 1, 6, func(c *Config) *int { return &c.DinnerEvery }),
	whole("dinners", "Dinners a night", "Dinner", "", 0, 6, func(c *Config) *int { return &c.Dinners }),
	num("discuss", "Discussion time", "Meetings", "s", 5, 180, 5, func(c *Config) *float64 { return &c.Discuss }),
	num("vote", "Voting time", "Meetings", "s", 5, 60, 5, func(c *Config) *float64 { return &c.Vote }),
	num("speed", "Walking speed", "Movement", "tiles/s", 1, 12, 0.5, func(c *Config) *float64 { return &c.Speed }),
	num("ghostSpeed", "Ghost speed", "Movement", "tiles/s", 1, 15, 0.5, func(c *Config) *float64 { return &c.GhostSpeed }),
	layout(whole("roomWidth", "Room width", "The manor", "tiles", MinRoomWidth, MaxRoomSize, func(c *Config) *int { return &c.RoomWidth })),
	layout(whole("roomHeight", "Room height", "The manor", "tiles", MinRoomHeight, MaxRoomSize, func(c *Config) *int { return &c.RoomHeight })),
	num("burnPerSec", "Wax burned per second", "Candles", "", 0.1, 2, 0.1, func(c *Config) *float64 { return &c.BurnPerSec }),
	num("fullRadius", "Candlelight reach", "Candles", "tiles", 2, 8, 0.5, func(c *Config) *float64 { return &c.FullRadius }),
	num("snuffTime", "Time to snuff a candle", "The Host", "s", 0.2, 5, 0.1, func(c *Config) *float64 { return &c.SnuffTime }),
	num("snuffCD", "Wait between snuffs", "The Host", "s", 5, 90, 5, func(c *Config) *float64 { return &c.SnuffCD }),
	num("killCD", "Wait between kills", "The Host", "s", 5, 90, 5, func(c *Config) *float64 { return &c.KillCD }),
	num("hearRange", "Snuffs and kills heard within", "The Host", "tiles", 0, 20, 1, func(c *Config) *float64 { return &c.HearRange }),
}

// SettingValues reads every setting from the config.
func (c *Config) SettingValues() map[string]float64 {
	out := map[string]float64{}
	for _, s := range Settings {
		out[s.Key] = s.get(c)
	}
	return out
}

// ApplySettings changes the named settings. Every value must be a known
// setting within its range; it is rounded to the setting's step. Nothing
// changes unless all of them are valid.
func (c *Config) ApplySettings(values map[string]float64) error {
	next := *c
	for key, v := range values {
		var s *Setting
		for i := range Settings {
			if Settings[i].Key == key {
				s = &Settings[i]
			}
		}
		if s == nil {
			return fmt.Errorf("no setting %q", key)
		}
		if math.IsNaN(v) || v < s.Min || v > s.Max {
			return fmt.Errorf("%s must be %g to %g", s.Label, s.Min, s.Max)
		}
		v = s.Min + math.Round((v-s.Min)/s.Step)*s.Step
		s.set(&next, math.Round(v*1000)/1000)
	}
	if err := next.Validate(); err != nil {
		return err
	}
	*c = next
	return nil
}

// ApplySettings changes the rules of a match in progress. The manor's size
// is kept (it is already built). A new hour length keeps the clock at the
// same time of night rather than jumping hours ahead or back.
func (m *Match) ApplySettings(values map[string]float64) error {
	next := m.Cfg
	if err := next.ApplySettings(values); err != nil {
		return err
	}
	next.RoomWidth, next.RoomHeight = m.Cfg.RoomWidth, m.Cfg.RoomHeight
	if next.HourSeconds != m.Cfg.HourSeconds {
		m.Clock = m.Clock / m.Cfg.HourSeconds * next.HourSeconds
	}
	m.Cfg = next
	return nil
}
