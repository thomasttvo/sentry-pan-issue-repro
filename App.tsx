/**
 * Sentry Session Replay Jitter Reproduction
 *
 * replaysOnErrorSampleRate > 0 → Session Replay screenshot capture causes ~1s periodic jitter
 *
 * Toggle replay ON → kill & restart → press "Run Test"
 * A ball animates in a circle while frame intervals are captured.
 * Jitter from Sentry Replay shows as red spikes in the results chart.
 */

import React, {useEffect, useState, useCallback, useRef} from 'react';
import {
  StyleSheet,
  View,
  Text,
  Dimensions,
  Switch,
  Alert,
  ActivityIndicator,
  TouchableOpacity,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Sentry from '@sentry/react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  useFrameCallback,
  withTiming,
  withRepeat,
  Easing,
  runOnJS,
  cancelAnimation,
} from 'react-native-reanimated';

const REPLAY_KEY = 'sentryReplay';

const {width} = Dimensions.get('window');

const JITTER_THRESHOLD_MS = 20;
const TEST_DURATION_MS = 6000;

let sentryInitialized = false;

function initSentry(replay: boolean) {
  if (sentryInitialized) return;
  sentryInitialized = true;
  Sentry.init({
    dsn: 'https://your-dsn@sentry.io/project', // Replace with real DSN to test
    enableAutoPerformanceTracing: false,
    tracesSampleRate: 0,
    replaysOnErrorSampleRate: replay ? 1.0 : 0,
    replaysSessionSampleRate: 0,
  });
}

interface TestResults {
  deltas: number[];
  avgDelta: number;
  maxDelta: number;
  jitterCount: number;
  durationSec: number;
}

function ResultsChart({results}: {results: TestResults}) {
  const {deltas, avgDelta, maxDelta, jitterCount, durationSec} = results;
  const chartWidth = width - 40;
  const chartHeight = 120;
  const normalBarHeight = 10;

  const getBarHeight = (delta: number) => {
    if (delta <= 16) return normalBarHeight;
    const ratio = (delta - 16) / (Math.max(maxDelta, 50) - 16);
    return normalBarHeight + ratio * (chartHeight - normalBarHeight);
  };

  return (
    <View style={styles.chartSection}>
      <View style={styles.statsRow}>
        <Text style={styles.statLabel}>
          avg <Text style={styles.statValue}>{avgDelta}ms</Text>
        </Text>
        <Text style={styles.statLabel}>
          max <Text style={[styles.statValue, maxDelta > JITTER_THRESHOLD_MS && styles.statBad]}>
            {maxDelta}ms
          </Text>
        </Text>
        <Text style={styles.statLabel}>
          jitter <Text style={[styles.statValue, jitterCount > 0 && styles.statBad]}>
            {jitterCount}x
          </Text>
        </Text>
        <Text style={styles.statLabel}>
          {durationSec}s · {deltas.length} frames
        </Text>
      </View>
      <View style={[styles.chartContainer, {height: chartHeight}]}>
        {deltas.map((delta, i) => {
          const isJitter = delta > JITTER_THRESHOLD_MS;
          if (!isJitter) return null;
          const h = getBarHeight(delta);
          return (
            <View
              key={i}
              style={{
                width: Math.max(4, chartWidth / deltas.length),
                height: Math.min(h, chartHeight),
                backgroundColor: '#ff6b6b',
                position: 'absolute',
                bottom: 0,
                left: (i / deltas.length) * chartWidth,
                zIndex: 1,
              }}
            />
          );
        })}
        <View style={styles.baselineFill} />
      </View>
      <View style={styles.chartLegend}>
        <View style={[styles.legendDot, {backgroundColor: 'rgba(105,219,124,0.4)'}]} />
        <Text style={styles.legendText}>normal (&lt;{JITTER_THRESHOLD_MS}ms)</Text>
        <View style={[styles.legendDot, {backgroundColor: '#ff6b6b'}]} />
        <Text style={styles.legendText}>jitter (&gt;{JITTER_THRESHOLD_MS}ms)</Text>
      </View>
    </View>
  );
}

function AnimationArea({running, onTestComplete}: {
  running: boolean;
  onTestComplete: (deltas: number[]) => void;
}) {
  const progress = useSharedValue(0);
  const isRunning = useSharedValue(false);
  const lastTime = useSharedValue(0);
  const deltasRef = useRef<number[]>([]);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const pushDelta = useCallback((delta: number) => {
    deltasRef.current.push(delta);
  }, []);

  const finishTest = useCallback(() => {
    isRunning.value = false;
    cancelAnimation(progress);
    progress.value = 0;
    onTestComplete(deltasRef.current);
  }, [isRunning, progress, onTestComplete]);

  useEffect(() => {
    if (running) {
      deltasRef.current = [];
      lastTime.value = 0;
      isRunning.value = true;
      progress.value = 0;
      progress.value = withRepeat(
        withTiming(1, {duration: 1000, easing: Easing.linear}),
        -1,
        false,
      );
      timerRef.current = setTimeout(finishTest, TEST_DURATION_MS);
    } else {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      isRunning.value = false;
      cancelAnimation(progress);
      progress.value = 0;
    }
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [running, progress, lastTime, isRunning, finishTest]);

  useFrameCallback(() => {
    'worklet';
    if (!isRunning.value) return;
    const now = Date.now();
    if (lastTime.value === 0) {
      lastTime.value = now;
      return;
    }
    const delta = now - lastTime.value;
    lastTime.value = now;
    runOnJS(pushDelta)(delta);
  });

  const orbitRadius = 80;
  const centerX = (width - 40) / 2;
  const centerY = 100;

  const ballStyle = useAnimatedStyle(() => {
    const angle = progress.value * 2 * Math.PI;
    return {
      transform: [
        {translateX: centerX + Math.cos(angle) * orbitRadius - 15},
        {translateY: centerY + Math.sin(angle) * orbitRadius - 15},
      ],
    };
  });

  const trailStyle = useAnimatedStyle(() => {
    const angle = progress.value * 2 * Math.PI - 0.3;
    return {
      transform: [
        {translateX: centerX + Math.cos(angle) * orbitRadius - 10},
        {translateY: centerY + Math.sin(angle) * orbitRadius - 10},
      ],
      opacity: 0.3,
    };
  });

  return (
    <View style={styles.animArea}>
      <View style={[styles.orbitRing, {
        width: orbitRadius * 2 + 30,
        height: orbitRadius * 2 + 30,
        borderRadius: orbitRadius + 15,
        left: centerX - orbitRadius - 15,
        top: centerY - orbitRadius - 15,
      }]} />
      <Animated.View style={[styles.trail, trailStyle]} />
      <Animated.View style={[styles.ball, ballStyle]} />
    </View>
  );
}

function App() {
  const [loading, setLoading] = useState(true);
  const [replayOn, setReplayOn] = useState(false);
  const [running, setRunning] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [results, setResults] = useState<TestResults | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    (async () => {
      const replayVal = await AsyncStorage.getItem(REPLAY_KEY);
      const replay = replayVal === 'true';
      setReplayOn(replay);
      initSentry(replay);
      setLoading(false);
    })();
  }, []);

  const toggleReplay = useCallback(async (newValue: boolean) => {
    await AsyncStorage.setItem(REPLAY_KEY, String(newValue));
    setReplayOn(newValue);
    Alert.alert(
      'Restart Required',
      'Kill and restart the app for changes to take effect.',
    );
  }, []);

  const onTestComplete = useCallback((deltas: number[]) => {
    setRunning(false);
    if (countdownRef.current) {
      clearInterval(countdownRef.current);
      countdownRef.current = null;
    }
    setCountdown(0);
    if (deltas.length > 0) {
      const sum = deltas.reduce((a, b) => a + b, 0);
      setResults({
        deltas,
        avgDelta: Math.round((sum / deltas.length) * 10) / 10,
        maxDelta: Math.round(Math.max(...deltas) * 10) / 10,
        jitterCount: deltas.filter(d => d > JITTER_THRESHOLD_MS).length,
        durationSec: Math.round(sum / 100) / 10,
      });
    }
  }, []);

  const startTest = useCallback(() => {
    setResults(null);
    setRunning(true);
    setCountdown(Math.ceil(TEST_DURATION_MS / 1000));
    countdownRef.current = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) {
          if (countdownRef.current) {
            clearInterval(countdownRef.current);
            countdownRef.current = null;
          }
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }, []);

  if (loading) {
    return (
      <View style={[styles.container, styles.center]}>
        <ActivityIndicator size="large" color="white" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Sentry Replay Jitter Test</Text>
        <Text style={styles.instruction}>
          Toggle replay → kill & restart → Run Test
        </Text>
        <View style={styles.toggleRow}>
          <Text style={[styles.toggleLabel, replayOn && styles.toggleLabelOn]}>
            replaysOnErrorSampleRate: {replayOn ? 'ON' : 'OFF'}
          </Text>
          <Switch value={replayOn} onValueChange={toggleReplay} />
        </View>
        <TouchableOpacity
          style={[styles.runButton, running && styles.runButtonActive]}
          onPress={running ? undefined : startTest}
          disabled={running}>
          <Text style={styles.runButtonText}>
            {running ? `Testing... ${countdown}s` : 'Run Test (6s)'}
          </Text>
        </TouchableOpacity>
      </View>
      {results && <ResultsChart results={results} />}
      <AnimationArea running={running} onTestComplete={onTestComplete} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a1a1a',
  },
  center: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  header: {
    paddingTop: 60,
    paddingHorizontal: 20,
    paddingBottom: 8,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: 'white',
  },
  instruction: {
    fontSize: 13,
    color: '#888',
    marginTop: 4,
    marginBottom: 12,
  },
  toggleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
  },
  toggleLabel: {
    fontSize: 13,
    color: '#69db7c',
    flex: 1,
    marginRight: 12,
  },
  toggleLabelOn: {
    color: '#ff6b6b',
  },
  runButton: {
    backgroundColor: '#2ecc71',
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 8,
  },
  runButtonActive: {
    backgroundColor: '#e67e22',
  },
  runButtonText: {
    color: 'white',
    fontSize: 18,
    fontWeight: '700',
  },
  chartSection: {
    paddingHorizontal: 20,
    paddingVertical: 8,
  },
  statsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginBottom: 6,
  },
  statLabel: {
    fontSize: 12,
    color: '#888',
  },
  statValue: {
    color: '#69db7c',
    fontWeight: 'bold',
    fontVariant: ['tabular-nums'],
  },
  statBad: {
    color: '#ff6b6b',
  },
  chartContainer: {
    backgroundColor: '#111',
    borderRadius: 6,
    overflow: 'hidden',
    position: 'relative',
  },
  baselineFill: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 10,
    backgroundColor: 'rgba(105, 219, 124, 0.4)',
    borderRadius: 2,
  },
  chartLegend: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 4,
    flexWrap: 'wrap',
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginLeft: 8,
  },
  legendText: {
    fontSize: 10,
    color: '#666',
  },
  animArea: {
    flex: 1,
    position: 'relative',
  },
  orbitRing: {
    position: 'absolute',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    borderStyle: 'dashed',
  },
  ball: {
    position: 'absolute',
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#3498db',
  },
  trail: {
    position: 'absolute',
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#3498db',
  },
});

export default App;
