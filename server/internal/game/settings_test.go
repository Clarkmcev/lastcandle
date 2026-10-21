package game

import (
	"fmt"
	"testing"
)

func TestApplySettings(t *testing.T) {
	cfg := DefaultConfig()
	if err := cfg.ApplySettings(map[string]float64{"discuss": 20, "speed": 6.3, "roomWidth": 18}); err != nil {
		t.Fatal(err)
	}
	if cfg.Discuss != 20 || cfg.Speed != 6.5 || cfg.RoomWidth != 18 {
		t.Fatalf("got discuss %v, speed %v (rounded to its 0.5 step), room width %d", cfg.Discuss, cfg.Speed, cfg.RoomWidth)
	}
	if v := cfg.SettingValues(); v["discuss"] != 20 || v["roomWidth"] != 18 {
		t.Fatalf("values %v", v)
	}
	before := cfg
	for _, bad := range []map[string]float64{
		{"discuss": 2},             // below its range
		{"roomHeight": 99},         // above it
		{"tick": 1},                // not a setting
		{"speed": 5, "sandbox": 1}, // one bad key spoils the batch
	} {
		if err := cfg.ApplySettings(bad); err == nil {
			t.Errorf("%v: want an error", bad)
		}
		if cfg != before {
			t.Fatalf("%v: a rejected change must leave the config alone", bad)
		}
	}
}

func TestEverySettingIsReadableAndInRange(t *testing.T) {
	cfg := DefaultConfig()
	values := cfg.SettingValues()
	for _, s := range Settings {
		v, ok := values[s.Key]
		if !ok {
			t.Fatalf("%s missing", s.Key)
		}
		if v < s.Min || v > s.Max {
			t.Errorf("%s default %v is outside %v..%v", s.Key, v, s.Min, s.Max)
		}
	}
	if err := cfg.ApplySettings(values); err != nil {
		t.Fatalf("defaults should apply cleanly: %v", err)
	}
}

func TestSettingsChangeAMatchInProgress(t *testing.T) {
	m := NewMatch(DefaultConfig(), seats(4), 1)
	m.Clock = 2.5 * m.Cfg.HourSeconds // 12:30 AM
	m.hour = m.Hour()
	if err := m.ApplySettings(map[string]float64{"hourSeconds": 20, "speed": 7, "roomWidth": 25}); err != nil {
		t.Fatal(err)
	}
	if m.Cfg.Speed != 7 {
		t.Fatalf("speed %v", m.Cfg.Speed)
	}
	if h, mins := m.ClockFace(); m.Hour() != 2 || mins != 30 {
		t.Fatalf("a new hour length moved the clock: hour %d, %d:%02d", m.Hour(), h, mins)
	}
	if m.Cfg.RoomWidth != BaseRoomWidth {
		t.Fatal("the manor is already built; its size must wait for the next match")
	}
}

func TestDinnerScheduleAndWitchingHourFollowSettings(t *testing.T) {
	cfg := DefaultConfig()
	if err := cfg.ApplySettings(map[string]float64{"firstDinner": 3, "dinnerEvery": 3, "dinners": 2, "witchingHour": 2}); err != nil {
		t.Fatal(err)
	}
	m := NewMatch(cfg, seats(4), 1)
	var dinners []int
	for h := 0; h < cfg.NightHours; h++ {
		if m.isDinner(h) {
			dinners = append(dinners, h)
		}
	}
	if fmt.Sprint(dinners) != "[3 6]" {
		t.Fatalf("dinners at hours %v, want 3 and 6 (1 AM and 4 AM)", dinners)
	}
	m.Clock = 2.5 * cfg.HourSeconds
	if !m.Witching() {
		t.Fatal("the Witching Hour should now be midnight")
	}
	if clockTime(2) != "12 AM" || clockTime(5) != "3 AM" || clockTime(0) != "10 PM" {
		t.Fatalf("clock names: %s %s %s", clockTime(0), clockTime(2), clockTime(5))
	}
	cfg.Dinners = 0
	if m := NewMatch(cfg, seats(4), 1); m.isDinner(3) {
		t.Fatal("no dinners when dinners is 0")
	}
}
