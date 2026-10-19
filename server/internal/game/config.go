package game

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

	Speed      float64
	GhostSpeed float64

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
	SmokeTime      float64
	DripTime       float64
	DripEvery      float64
	FarCandleSight float64 // a lit candle can be seen from this far in the dark
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
		GhostSpeed:     5,
		SnuffRange:     1.2,
		SnuffTime:      1.5,
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
		Discuss:        50,
		Vote:           15,
		Result:         5,
		EctoPerHour:    6,
		RestlessChance: 0.25,
		MirrorLagTicks: 10,
		MirrorRange:    2,
		MirrorWordTime: 30,
		KnockRange:     16,
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
