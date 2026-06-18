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
	"strconv"
	"time"
)

const (
	mobileAPIBase = "https://mobile.cronometer.com/api/v2"
	loginEndpoint = mobileAPIBase + "/login"
	diaryEndpoint = mobileAPIBase + "/get_diary"
	foodEndpoint  = mobileAPIBase + "/get_food"
)

type LoginRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

type LoginResponse struct {
	Result       string                 `json:"result"`
	Error        string                 `json:"error"`
	Token        string                 `json:"token"`
	SessionKey   string                 `json:"sessionKey"`
	JWTSignature string                 `json:"JWTSignature"`
	UUID         string                 `json:"uuid"`
	ID           int                    `json:"id"`
	Data         map[string]interface{} `json:"data"`
}

type DiaryEntry struct {
	FoodID        int     `json:"foodId"`
	Grams         float64 `json:"grams"`
	Time          string  `json:"time"`
	Day           string  `json:"day"`
	Type          string  `json:"type"`
	ServingID     int     `json:"servingId"`
	MeasureID     int     `json:"measureId"`
	UserID        int     `json:"userId"`
	Order         int     `json:"order"`
	TranslationID int     `json:"translationId"`
	Offset        int     `json:"offset"`
}

type DiaryResponse struct {
	Diary []DiaryEntry `json:"diary"`
}

type FoodDetail struct {
	ID        int                    `json:"id"`
	Name      string                 `json:"name"`
	Nutrition map[string]interface{} `json:"nutrition"`
}

type FoodResponse struct {
	Food FoodDetail `json:"food"`
}

type FoodRequest struct {
	Auth    AuthBlock `json:"auth"`
	FoodID  int       `json:"foodId"`
	Config  map[string]interface{} `json:"config"`
}

type AuthBlock struct {
	UserID  string `json:"userId"`
	Token   string `json:"token"`
	API     int    `json:"api"`
	OS      string `json:"os"`
	Build   string `json:"build"`
	Flavour string `json:"flavour"`
}

type DiaryRequest struct {
	Auth      AuthBlock              `json:"auth"`
	Day       string                 `json:"day"`
	LastSeen  int                    `json:"lastSeen"`
	Config    map[string]interface{} `json:"config"`
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
	sessionToken, userID, err := login(client, *username, *password)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error logging in: %v\n", err)
		os.Exit(1)
	}

	fmt.Fprintf(os.Stderr, "DEBUG: login successful, received session token\n")

	// Fetch diary entries for each day in range and output as CSV
	err = fetchAndOutputDiary(ctx, client, sessionToken, userID, startDate, endDate)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error fetching diary: %v\n", err)
		os.Exit(1)
	}
}

func login(client *http.Client, email, password string) (string, string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	payload := LoginRequest{
		Email:    email,
		Password: password,
	}

	body, err := json.Marshal(payload)
	if err != nil {
		return "", "", fmt.Errorf("failed to marshal login request: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, "POST", loginEndpoint, bytes.NewReader(body))
	if err != nil {
		return "", "", fmt.Errorf("failed to create login request: %w", err)
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "Cronometer/1.0")

	resp, err := client.Do(req)
	if err != nil {
		return "", "", fmt.Errorf("login request failed: %w", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", "", fmt.Errorf("failed to read login response: %w", err)
	}

	fmt.Fprintf(os.Stderr, "DEBUG: login status=%d\n", resp.StatusCode)
	fmt.Fprintf(os.Stderr, "DEBUG: login response=%s\n", string(respBody))
	fmt.Fprintf(os.Stderr, "DEBUG: login headers=%v\n", resp.Header)

	var loginResp LoginResponse
	err = json.Unmarshal(respBody, &loginResp)
	if err != nil {
		return "", "", fmt.Errorf("failed to parse login response: %w", err)
	}

	// Check if login failed
	if loginResp.Result == "FAIL" || loginResp.Error != "" {
		return "", "", fmt.Errorf("login failed: %s", loginResp.Error)
	}

	// Try to get token from response body first
	token := loginResp.Token
	fmt.Fprintf(os.Stderr, "DEBUG: Token field: %q, SessionKey field: %q\n", loginResp.Token, loginResp.SessionKey)
	if token == "" && loginResp.SessionKey != "" {
		token = loginResp.SessionKey
		fmt.Fprintf(os.Stderr, "DEBUG: using sessionKey as token\n")
	}
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

	// Try JWT signature if other tokens failed
	if token == "" && loginResp.JWTSignature != "" {
		token = loginResp.JWTSignature
		fmt.Fprintf(os.Stderr, "DEBUG: using JWTSignature as token\n")
	}

	if token == "" {
		return "", "", fmt.Errorf("no session token found in login response (result=%s, data=%v)", loginResp.Result, loginResp.Data)
	}

	fmt.Fprintf(os.Stderr, "DEBUG: extracted token (length=%d), first 20 chars: %.20s\n", len(token), token)

	// Extract userID from response (top-level ID field)
	userID := loginResp.ID
	fmt.Fprintf(os.Stderr, "DEBUG: userID: %d\n", userID)
	if userID == 0 {
		// Fallback to Data["id"] if top-level ID is missing
		if id, ok := loginResp.Data["id"]; ok {
			userID = int(id.(float64))
			fmt.Fprintf(os.Stderr, "DEBUG: userID from Data: %d\n", userID)
		}
	}

	if userID == 0 {
		return "", "", fmt.Errorf("no userID found in login response")
	}

	return token, fmt.Sprintf("%d", userID), nil
}

func fetchAndOutputDiary(ctx context.Context, client *http.Client, sessionToken, userID string, startDate, endDate time.Time) error {
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

		diary, err := fetchDiary(ctx, client, sessionToken, userID, dateStr)
		if err != nil {
			fmt.Fprintf(os.Stderr, "Warning: failed to fetch diary for %s: %v\n", dateStr, err)
			current = current.AddDate(0, 0, 1)
			continue
		}

		// Convert diary entries to CSV rows
		for _, entry := range diary.Diary {
			// Convert userID from string to int
			userIDInt, err := strconv.Atoi(userID)
			if err != nil {
				fmt.Fprintf(os.Stderr, "Warning: invalid userID %s: %v\n", userID, err)
				continue
			}

			// Fetch food details for this entry
			food, err := fetchFood(ctx, client, sessionToken, userIDInt, entry.FoodID)
			if err != nil {
				fmt.Fprintf(os.Stderr, "Warning: failed to fetch food %d for %s: %v\n", entry.FoodID, dateStr, err)
				continue
			}

			if food == nil || food.Name == "" {
				continue
			}

			timeStr := entry.Time
			if timeStr == "" {
				timeStr = "12:00:00"
			}

			// Extract nutrition values, defaulting to 0
			nut := food.Nutrition
			row := fmt.Sprintf("%s,%s,%s,%v,%v,%v,%v,%v,%v,%v,%v,%v,%v,%v,%v,%v,%v,%v,%v,%v,%v,%v",
				dateStr,
				timeStr,
				food.Name,
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

func fetchDiary(ctx context.Context, client *http.Client, sessionToken, userID, dateStr string) (*DiaryResponse, error) {
	reqCtx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()

	url := diaryEndpoint

	// Build auth block
	auth := AuthBlock{
		UserID:  userID,
		Token:   sessionToken,
		API:     3,
		OS:      "Android",
		Build:   "2807",
		Flavour: "free",
	}

	// Build request payload with auth in the body
	payload := DiaryRequest{
		Auth:     auth,
		Day:      dateStr,
		LastSeen: 0,
		Config: map[string]interface{}{
			"call_version": 1,
		},
	}

	body, _ := json.Marshal(payload)

	req, err := http.NewRequestWithContext(reqCtx, "POST", url, bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("failed to create diary request: %w", err)
	}

	req.Header.Set("Content-Type", "application/json")

	fmt.Fprintf(os.Stderr, "DEBUG: diary POST request with userID=%s, date=%s, auth in body\n", userID, dateStr)

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

	fmt.Fprintf(os.Stderr, "DEBUG: diary response (first 500 chars): %s\n", string(respBody[:min(len(respBody), 500)]))

	var diaryResp DiaryResponse
	err = json.Unmarshal(respBody, &diaryResp)
	if err != nil {
		return nil, fmt.Errorf("failed to parse diary response: %w", err)
	}

	fmt.Fprintf(os.Stderr, "DEBUG: parsed %d foods for %s\n", len(diaryResp.Diary), dateStr)
	return &diaryResp, nil
}

func fetchFood(ctx context.Context, client *http.Client, sessionToken string, userID int, foodID int) (*FoodDetail, error) {
	reqCtx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()

	// Build auth block
	auth := AuthBlock{
		UserID:  fmt.Sprintf("%d", userID),
		Token:   sessionToken,
		API:     3,
		OS:      "Android",
		Build:   "2807",
		Flavour: "free",
	}

	// Build request payload
	payload := FoodRequest{
		Auth:   auth,
		FoodID: foodID,
		Config: map[string]interface{}{
			"call_version": 1,
		},
	}

	body, _ := json.Marshal(payload)

	req, err := http.NewRequestWithContext(reqCtx, "POST", foodEndpoint, bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("failed to create food request: %w", err)
	}

	req.Header.Set("Content-Type", "application/json")

	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("food request failed: %w", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read food response: %w", err)
	}

	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("food request failed with status %d", resp.StatusCode)
	}

	var foodResp FoodResponse
	err = json.Unmarshal(respBody, &foodResp)
	if err != nil {
		return nil, fmt.Errorf("failed to parse food response: %w", err)
	}

	return &foodResp.Food, nil
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
