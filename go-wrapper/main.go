package main

import (
	"bytes"
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"net/http"
	"net/http/cookiejar"
	"os"
	"time"
)

const (
	mobileAPIBase = "https://mobile.cronometer.com/api/v2"
	loginEndpoint = mobileAPIBase + "/login"
	diaryEndpoint = mobileAPIBase + "/get_diary"
)

type LoginRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

type LoginResponse struct {
	Result  string `json:"result"`
	Error   string `json:"error"`
	Token   string `json:"token"`
	Data    map[string]interface{} `json:"data"`
}

type DiaryEntry struct {
	Name        string                 `json:"name"`
	Day         string                 `json:"date"`
	Time        string                 `json:"time"`
	Nutrition   map[string]interface{} `json:"nutrition"`
	FoodID      string                 `json:"food_id"`
	EntryID     string                 `json:"entry_id"`
	ReferenceID string                 `json:"reference_id"`
}

type DiaryResponse struct {
	Foods []DiaryEntry `json:"foods"`
	Date  string       `json:"date"`
}

func main() {
	username := flag.String("u", "", "Username (email)")
	password := flag.String("p", "", "Password")
	startDateStr := flag.String("s", "", "Start Date (YYYY-MM-DD)")
	endDateStr := flag.String("e", "", "End Date (YYYY-MM-DD)")
	flag.Parse()

	if *username == "" || *password == "" || *startDateStr == "" || *endDateStr == "" {
		fmt.Fprintf(os.Stderr, "Usage: gocronometer-wrapper -u <email> -p <password> -s <start_date> -e <end_date>\n")
		os.Exit(1)
	}

	// Set process-level timeout
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	startDate, err := time.Parse("2006-01-02", *startDateStr)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error parsing start date: %v\n", err)
		os.Exit(1)
	}

	endDate, err := time.Parse("2006-01-02", *endDateStr)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error parsing end date: %v\n", err)
		os.Exit(1)
	}

	// Create HTTP client with cookie jar and timeout
	jar, err := cookiejar.New(nil)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error creating cookie jar: %v\n", err)
		os.Exit(1)
	}

	client := &http.Client{
		Timeout: 30 * time.Second,
		Jar:     jar,
	}

	// Login and get session token
	sessionToken, err := login(client, *username, *password)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error logging in: %v\n", err)
		os.Exit(1)
	}

	fmt.Fprintf(os.Stderr, "DEBUG: login successful, received session token\n")

	// Fetch diary entries for each day in range and output as CSV
	err = fetchAndOutputDiary(ctx, client, sessionToken, startDate, endDate)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error fetching diary: %v\n", err)
		os.Exit(1)
	}
}

func login(client *http.Client, email, password string) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	payload := LoginRequest{
		Email:    email,
		Password: password,
	}

	body, err := json.Marshal(payload)
	if err != nil {
		return "", fmt.Errorf("failed to marshal login request: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, "POST", loginEndpoint, bytes.NewReader(body))
	if err != nil {
		return "", fmt.Errorf("failed to create login request: %w", err)
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "Cronometer/1.0")

	resp, err := client.Do(req)
	if err != nil {
		return "", fmt.Errorf("login request failed: %w", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", fmt.Errorf("failed to read login response: %w", err)
	}

	fmt.Fprintf(os.Stderr, "DEBUG: login status=%d\n", resp.StatusCode)
	fmt.Fprintf(os.Stderr, "DEBUG: login response=%s\n", string(respBody))
	fmt.Fprintf(os.Stderr, "DEBUG: login headers=%v\n", resp.Header)

	var loginResp LoginResponse
	err = json.Unmarshal(respBody, &loginResp)
	if err != nil {
		return "", fmt.Errorf("failed to parse login response: %w", err)
	}

	// Check if login failed
	if loginResp.Result == "FAIL" || loginResp.Error != "" {
		return "", fmt.Errorf("login failed: %s", loginResp.Error)
	}

	// Try to get token from response body first
	token := loginResp.Token
	if token == "" && loginResp.Data != nil {
		if t, ok := loginResp.Data["token"]; ok {
			token = fmt.Sprintf("%v", t)
		}
	}

	// Check for JSESSIONID cookie
	if token == "" {
		for _, cookie := range resp.Cookies() {
			if cookie.Name == "JSESSIONID" {
				token = cookie.Value
				fmt.Fprintf(os.Stderr, "DEBUG: extracted JSESSIONID from cookies\n")
				break
			}
		}
	}

	// Check response headers for session token
	if token == "" {
		if headerToken := resp.Header.Get("x-crono-session"); headerToken != "" {
			token = headerToken
			fmt.Fprintf(os.Stderr, "DEBUG: extracted token from x-crono-session header\n")
		}
	}

	if token == "" {
		return "", fmt.Errorf("no session token found in login response (result=%s, data=%v)", loginResp.Result, loginResp.Data)
	}

	fmt.Fprintf(os.Stderr, "DEBUG: extracted token (length=%d)\n", len(token))
	return token, nil
}

func fetchAndOutputDiary(ctx context.Context, client *http.Client, sessionToken string, startDate, endDate time.Time) error {
	// Output CSV header
	fmt.Println("Day,Time,Food Name,Energy (kcal),Protein (g),Carbs (g),Fat (g),Fiber (g),Sugars (g),Sodium (mg),Iron (mg),Calcium (mg),Vitamin C (mg),Vitamin A (µg),Vitamin D (µg),Vitamin E (mg),Vitamin K (µg),Vitamin B12 (µg),Vitamin B6 (mg),Magnesium (mg),Potassium (mg),Zinc (mg),Water (ml)")

	// Iterate through each day
	current := startDate
	for !current.After(endDate) {
		// Check if context is done (process timeout)
		select {
		case <-ctx.Done():
			return fmt.Errorf("process timeout while fetching diary")
		default:
		}

		dateStr := current.Format("2006-01-02")

		diary, err := fetchDiary(ctx, client, sessionToken, dateStr)
		if err != nil {
			fmt.Fprintf(os.Stderr, "Warning: failed to fetch diary for %s: %v\n", dateStr, err)
			current = current.AddDate(0, 0, 1)
			continue
		}

		// Convert diary entries to CSV rows
		for _, entry := range diary.Foods {
			if entry.Name == "" {
				continue
			}

			timeStr := entry.Time
			if timeStr == "" {
				timeStr = "12:00:00"
			}

			// Extract nutrition values, defaulting to 0
			nut := entry.Nutrition
			row := fmt.Sprintf("%s,%s,%s,%v,%v,%v,%v,%v,%v,%v,%v,%v,%v,%v,%v,%v,%v,%v,%v,%v,%v,%v",
				dateStr,
				timeStr,
				entry.Name,
				getFloat(nut, "energy_kcal"),
				getFloat(nut, "protein_g"),
				getFloat(nut, "carbs_g"),
				getFloat(nut, "fat_g"),
				getFloat(nut, "fiber_g"),
				getFloat(nut, "sugars_g"),
				getFloat(nut, "sodium_mg"),
				getFloat(nut, "iron_mg"),
				getFloat(nut, "calcium_mg"),
				getFloat(nut, "vitamin_c_mg"),
				getFloat(nut, "vitamin_a_mcg"),
				getFloat(nut, "vitamin_d_mcg"),
				getFloat(nut, "vitamin_e_mg"),
				getFloat(nut, "vitamin_k_mcg"),
				getFloat(nut, "vitamin_b12_mcg"),
				getFloat(nut, "vitamin_b6_mg"),
				getFloat(nut, "magnesium_mg"),
				getFloat(nut, "potassium_mg"),
				getFloat(nut, "zinc_mg"),
				getFloat(nut, "water_ml"),
			)
			fmt.Println(row)
		}

		current = current.AddDate(0, 0, 1)
	}

	return nil
}

func fetchDiary(ctx context.Context, client *http.Client, sessionToken, dateStr string) (*DiaryResponse, error) {
	reqCtx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()

	url := diaryEndpoint

	payload := map[string]string{"date": dateStr}
	body, _ := json.Marshal(payload)

	req, err := http.NewRequestWithContext(reqCtx, "POST", url, bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("failed to create diary request: %w", err)
	}

	// Try both header and cookie for session token
	req.Header.Set("x-crono-session", sessionToken)
	req.Header.Set("Content-Type", "application/json")
	req.AddCookie(&http.Cookie{Name: "JSESSIONID", Value: sessionToken})

	fmt.Fprintf(os.Stderr, "DEBUG: diary POST request with date=%s, session token in header and cookie\n", dateStr)

	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("diary request failed: %w", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read diary response: %w", err)
	}

	fmt.Fprintf(os.Stderr, "DEBUG: diary request status=%d for %s\n", resp.StatusCode, dateStr)
	if resp.StatusCode != 200 {
		fmt.Fprintf(os.Stderr, "DEBUG: diary error response: %s\n", string(respBody))
		return nil, fmt.Errorf("diary request failed with status %d: %s", resp.StatusCode, string(respBody))
	}

	fmt.Fprintf(os.Stderr, "DEBUG: diary response for %s: %s\n", dateStr, string(respBody))

	var diaryResp DiaryResponse
	err = json.Unmarshal(respBody, &diaryResp)
	if err != nil {
		return nil, fmt.Errorf("failed to parse diary response: %w", err)
	}

	fmt.Fprintf(os.Stderr, "DEBUG: parsed %d foods for %s\n", len(diaryResp.Foods), dateStr)
	return &diaryResp, nil
}

func getFloat(m map[string]interface{}, key string) float64 {
	if v, ok := m[key]; ok {
		switch val := v.(type) {
		case float64:
			return val
		case int:
			return float64(val)
		case string:
			var f float64
			fmt.Sscanf(val, "%f", &f)
			return f
		}
	}
	return 0
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
