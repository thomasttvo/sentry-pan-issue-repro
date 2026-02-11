# Sentry Session Replay Jitter Reproduction

Minimal React Native app demonstrating that `@sentry/react-native` Session Replay causes periodic ~1s UI jitter when `replaysOnErrorSampleRate > 0`.

## The Issue

When Session Replay is enabled, Sentry periodically captures screenshots of the app. Each capture blocks the main thread for ~1 second, causing visible animation stutter and dropped frames.

## How to Reproduce

1. Clone and install:
   ```sh
   yarn install
   cd ios && pod install && cd ..
   ```

2. Replace the DSN in `App.tsx` with a real Sentry DSN (or leave as-is — the jitter occurs even with an invalid DSN).

3. Run the app:
   ```sh
   yarn ios
   ```

4. **Baseline test (Replay OFF):** Press "Run Test (6s)". The ball animates in a circle for 6 seconds while frame intervals are measured. You should see minimal or zero red jitter spikes.

5. **Toggle Replay ON**, kill and restart the app.

6. **Replay test (Replay ON):** Press "Run Test (6s)" again. You should see periodic red spikes in the chart — these are the ~1s stalls from Session Replay screenshot capture.

## Environment

- React Native 0.83.2
- @sentry/react-native ^6.14.0
- react-native-reanimated ^3.19.4
- iOS (not tested on Android)

## How It Works

The app uses Reanimated's `useFrameCallback` to measure frame-to-frame intervals via `Date.now()` on the UI thread. Frames exceeding 20ms are flagged as jitter. Results are displayed as a chart after the 6-second test completes.
