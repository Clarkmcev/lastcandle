package server

import (
	"net"
	"strconv"
	"testing"
)

func TestListenMovesToNextFreePort(t *testing.T) {
	busy, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer busy.Close()
	taken := busy.Addr().(*net.TCPAddr).Port

	l, err := Listen("127.0.0.1:"+strconv.Itoa(taken), 20)
	if err != nil {
		t.Fatal(err)
	}
	defer l.Close()
	if got := l.Addr().(*net.TCPAddr).Port; got <= taken {
		t.Fatalf("expected a port after %d, got %d", taken, got)
	}
}
