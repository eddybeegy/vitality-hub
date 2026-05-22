package main

import (
	"context"
	"flag"
	"fmt"
	"os"
	"time"

	"github.com/jrmycanady/gocronometer"
)

func main() {
	username := flag.String("u", "", "Username")
	password := flag.String("p", "", "Password")
	startDateStr := flag.String("s", "", "Start Date (YYYY-MM-DD or RFC3339)")
	endDateStr := flag.String("e", "", "End Date (YYYY-MM-DD or RFC3339)")
	// These flags are ignored but included for compatibility with the expected command
	_ = flag.String("t", "servings", "Type (ignored)")
	_ = flag.String("f", "raw", "Format (ignored)")

	flag.Parse()

	if *username == "" || *password == "" || *startDateStr == "" || *endDateStr == "" {
		fmt.Fprintf(os.Stderr, "Usage: gocronometer-wrapper -u <username> -p <password> -s <start_date> -e <end_date>\n")
		os.Exit(1)
	}

	// Parse dates
	start, err := parseDate(*startDateStr)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error parsing start date: %v\n", err)
		os.Exit(1)
	}
	end, err := parseDate(*endDateStr)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error parsing end date: %v\n", err)
		os.Exit(1)
	}

	// Create the client
	c := gocronometer.NewClient(nil)

	// Login to cronometer
	ctx := context.Background()
	err = c.Login(ctx, *username, *password)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error logging in: %v\n", err)
		os.Exit(1)
	}

	// Retrieve the export data
	rawCSVData, err := c.ExportServings(ctx, start, end)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error exporting servings: %v\n", err)
		os.Exit(1)
	}

	// Output raw CSV data
	fmt.Print(rawCSVData)
}

func parseDate(s string) (time.Time, error) {
	// Try RFC3339 first (e.g., 2025-12-23T10:52:19Z)
	if t, err := time.Parse(time.RFC3339, s); err == nil {
		return t, nil
	}
	// Try YYYY-MM-DD
	return time.Parse("2006-01-02", s)
}
