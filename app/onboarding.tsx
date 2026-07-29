import { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Dimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useTheme } from '../src/contexts/ThemeContext';

const { width } = Dimensions.get('window');

const STEPS = [
  {
    icon: 'bookmark' as const,
    title: 'Save Any Place',
    subtitle: 'Share from Instagram, Threads, OpenRice,\nGoogle Maps, RED, Dianping — or paste a link.\nAI fills in the details automatically.',
    color: '#FF6B35',
  },
  {
    icon: 'sparkles' as const,
    title: 'AI Does the Work',
    subtitle: 'Our AI extracts the name, address, district,\ncuisine, price, and tags from any link.\nEven reads text from post thumbnails.',
    color: '#007AFF',
  },
  {
    icon: 'map' as const,
    title: 'Ready When You Are',
    subtitle: "All your spots on one map with Near Me.\nShare lists with friends, export to CSV,\nand never forget a place again.",
    color: '#34C759',
  },
];

export default function OnboardingScreen() {
  const t = useTheme();
  const router = useRouter();
  const [step, setStep] = useState(0);

  const current = STEPS[step];
  const isLast = step === STEPS.length - 1;

  const handleNext = () => {
    if (isLast) {
      router.replace('/auth');
    } else {
      setStep(step + 1);
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: t.bgSecondary }]}>
      {/* Skip */}
      <TouchableOpacity style={styles.skip} onPress={() => router.replace('/auth')}>
        <Text style={[styles.skipText, { color: t.textSecondary }]}>Skip</Text>
      </TouchableOpacity>

      {/* Content */}
      <View style={styles.content}>
        <View style={[styles.iconCircle, { backgroundColor: `${current.color}15` }]}>
          <Ionicons name={current.icon} size={56} color={current.color} />
        </View>
        <Text style={[styles.title, { color: t.text }]}>{current.title}</Text>
        <Text style={[styles.subtitle, { color: t.textSecondary }]}>{current.subtitle}</Text>
      </View>

      {/* Dots + Button */}
      <View style={styles.footer}>
        <View style={styles.dots}>
          {STEPS.map((_, i) => (
            <View key={i} style={[styles.dot, i === step && styles.dotActive]} />
          ))}
        </View>
        <TouchableOpacity style={styles.button} onPress={handleNext}>
          <Text style={styles.buttonText}>{isLast ? 'Get Started' : 'Next'}</Text>
          <Ionicons name="arrow-forward" size={18} color="#FFF" />
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  skip: { position: 'absolute', top: 60, right: 24, zIndex: 1 },
  skipText: { fontSize: 15, fontWeight: '500' },
  content: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 40 },
  iconCircle: {
    width: 120, height: 120, borderRadius: 60,
    justifyContent: 'center', alignItems: 'center', marginBottom: 32,
  },
  title: { fontSize: 26, fontWeight: '800', textAlign: 'center', marginBottom: 12 },
  subtitle: { fontSize: 15, textAlign: 'center', lineHeight: 22 },
  footer: { paddingHorizontal: 32, paddingBottom: 50, paddingTop: 20 },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 8, marginBottom: 24 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#E5E5EA' },
  dotActive: { backgroundColor: '#FF6B35', width: 24 },
  button: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#FF6B35', paddingVertical: 16, borderRadius: 14, gap: 8,
  },
  buttonText: { fontSize: 16, fontWeight: '700', color: '#FFF' },
});
