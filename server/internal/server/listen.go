package server

import (
	"errors"
	"fmt"
	"net"
	"strconv"
	"syscall"
)

// Listen listens on addr, moving up to the next port while the requested
// one is already in use. It gives up after tries ports.
func Listen(addr string, tries int) (net.Listener, error) {
	host, portStr, err := net.SplitHostPort(addr)
	if err != nil {
		return nil, err
	}
	port, err := strconv.Atoi(portStr)
	if err != nil {
		return nil, fmt.Errorf("bad port in %q: %w", addr, err)
	}
	for i := 0; i < tries; i++ {
		l, err := net.Listen("tcp", net.JoinHostPort(host, strconv.Itoa(port+i)))
		if err == nil || !errors.Is(err, syscall.EADDRINUSE) {
			return l, err
		}
	}
	return nil, fmt.Errorf("ports %d to %d are all in use", port, port+tries-1)
}
