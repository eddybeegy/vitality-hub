# Health Tracker Application Documentation

Welcome to the Health Tracker application documentation. This application is a full-stack health tracking solution designed to integrate data from various sources, provide AI-driven insights, and help users manage their health goals.

## Overview
The application allows users to:
- Sync health data from modules like Cronometer, Hevy, Withings, and Apple Health.
- Visualize health metrics (weight, body fat, muscle mass, sleep, etc.) using interactive charts.
- Receive personalized AI insights based on their health data, persona, and focus.
- Manage health targets and medications.
- Configure AI settings (Persona, Focus, Model) for tailored advice.

## Key Features
- **Data Integration**: Syncs data from multiple health platforms.
- **AI-Driven Insights**: Uses Gemini API to provide daily nutrition and workout analysis.
- **Customizable AI**: Users can set AI Persona (e.g., "Encouraging Coach") and Focus (e.g., "Body Recomposition").
- **Timezone Awareness**: Robust handling of UTC timestamps to ensure daily metrics are accurate in the user's local timezone.
- **Secure Authentication**: JWT-based authentication with admin role management.

## Setup
1. Clone the repository.
2. Install dependencies: `npm install`.
3. Set up environment variables (see `.env.example`).
4. Start the development server: `npm run dev`.
