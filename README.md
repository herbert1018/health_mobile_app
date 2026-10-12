# NutriTrack — 個人營養追蹤 App | Personal Nutrition Tracking App

**Version:** v1.0.0  
**Platform:** Android  
**Framework:** React Native + Expo  
**Language:** TypeScript

---

# 繁體中文

## 專案介紹

NutriTrack 是一款以日常飲食紀錄與營養追蹤為核心的行動應用程式，協助使用者記錄每日飲食、分析營養攝取量，並依據個人設定的營養目標追蹤每日飲食狀況。

本專案整合 AI 輔助飲食分析功能，期望讓飲食紀錄更加便利，並幫助使用者了解自己的營養攝取情形。

## 主要功能

- **飲食紀錄：** 新增及管理每日飲食紀錄。
- **本機資料保存：** 使用 AsyncStorage 保存飲食紀錄，重新開啟 App 後仍可讀取。
- **每日營養目標：** 自訂每日熱量、蛋白質、碳水化合物與脂肪目標。
- **營養攝取摘要：** 比較每日營養攝取量與個人目標。
- **AI 輔助飲食分析：** 整合 Gemini API，協助分析飲食內容。
- **Android APK 打包：** 使用 Expo EAS Build 產生可安裝的 Android APK。

> 以上功能以目前實際完成並測試的內容為準。

## 技術架構

- React Native
- Expo
- Expo Router
- TypeScript
- AsyncStorage
- Gemini API
- Expo EAS Build

## 專案結構

```text
NutriTrack/
├── app/
│   ├── index.tsx
│   └── settings.tsx
├── assets/
├── services/
├── package.json
├── package-lock.json
├── app.json
├── eas.json
├── tsconfig.json
└── README.md
```

實際目錄可能隨開發進度調整。

## 安裝與執行

### 環境需求

- Node.js
- npm
- Expo Go（用於行動裝置開發測試）
- Expo 帳號（用於雲端建置）

### 下載專案

```bash
git clone https://github.com/YOUR_USERNAME/NutriTrack.git
cd NutriTrack
```

### 安裝相依套件

```bash
npm install
```

### 啟動開發環境

```bash
npx expo start
```

使用 Expo Go 掃描終端機顯示的 QR Code，即可在相容的行動裝置上執行 App。

## Gemini API 設定

若要使用 AI 輔助飲食分析，請依照 App 設定頁面的操作方式設定 Gemini API Key。

請勿將真實 API Key、密碼或其他敏感憑證提交至 GitHub。

## Android APK 打包

本專案使用 Expo EAS Build 進行 Android 雲端建置。

### 登入 Expo

```bash
npx eas-cli@latest login
```

### 建置 APK

請確認 `eas.json` 中的 `preview` 設定包含：

```json
{
  "distribution": "internal",
  "android": {
    "buildType": "apk"
  }
}
```

接著執行：

```bash
npx eas-cli@latest build --platform android --profile preview
```

建置完成後，透過 EAS 提供的建置頁面下載 APK，並安裝至相容的 Android 裝置。

## 資料儲存

飲食紀錄與每日營養目標使用 AsyncStorage 儲存在使用者的裝置上。目前本機資料不會自動同步至其他裝置。

## 版本紀錄

### v1.0.0

NutriTrack 初始版本，涵蓋飲食紀錄、本機資料保存、每日營養目標設定，以及 Expo/EAS 建置設定。

正式版本狀態以實際建置與裝置測試結果為準。

---

# English

## Overview

NutriTrack is a mobile application focused on daily meal logging and nutritional tracking. It helps users record meals, review nutritional intake, and monitor their progress toward personalized daily nutrition goals.

The project integrates AI-assisted meal analysis to make food logging more convenient and help users better understand their nutritional intake.

## Features

- **Meal Logging:** Add and manage daily meal records.
- **Local Persistence:** Store meal records using AsyncStorage and retain them across app restarts.
- **Daily Nutrition Targets:** Set personalized goals for calories, protein, carbohydrates, and fat.
- **Nutrition Summary:** Compare daily nutrient intake against personal targets.
- **AI-assisted Meal Analysis:** Integrate the Gemini API to assist with meal analysis.
- **Android APK Build:** Generate installable Android APKs through Expo EAS Build.

> Features should be considered available in this release only when implemented and verified.

## Tech Stack

- React Native
- Expo
- Expo Router
- TypeScript
- AsyncStorage
- Gemini API
- Expo EAS Build

## Project Structure

```text
NutriTrack/
├── app/
│   ├── index.tsx
│   └── settings.tsx
├── assets/
├── services/
├── package.json
├── package-lock.json
├── app.json
├── eas.json
├── tsconfig.json
└── README.md
```

The actual directory structure may evolve during development.

## Getting Started

### Prerequisites

- Node.js
- npm
- Expo Go for mobile development testing
- An Expo account for cloud builds

### Clone the Repository

```bash
git clone https://github.com/YOUR_USERNAME/NutriTrack.git
cd NutriTrack
```

### Install Dependencies

```bash
npm install
```

### Start the Development Server

```bash
npx expo start
```

Scan the QR code displayed in the terminal using Expo Go on a compatible mobile device.

## Gemini API Configuration

To use AI-assisted meal analysis, configure a Gemini API key through the app's settings page.

Never commit real API keys, passwords, or other sensitive credentials to GitHub.

## Building the Android APK

This project uses Expo EAS Build for cloud-based Android builds.

### Log in to Expo

```bash
npx eas-cli@latest login
```

### Build the APK

Ensure the `preview` profile in `eas.json` includes:

```json
{
  "distribution": "internal",
  "android": {
    "buildType": "apk"
  }
}
```

Run the following command:

```bash
npx eas-cli@latest build --platform android --profile preview
```

Once the build finishes, download the APK from the EAS build page and install it on a compatible Android device.

## Data Storage

Meal records and daily nutrition targets are stored locally on the device using AsyncStorage. Local data is not automatically synchronized across devices.

## Version History

### v1.0.0

Initial NutriTrack release baseline, covering meal logging, local data persistence, daily nutrition target configuration, and Expo/EAS build configuration.

Release readiness depends on successful builds and device testing.

---

## License

No license has been specified yet.