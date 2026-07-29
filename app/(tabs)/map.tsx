import { useState, useEffect } from 'react';
import { View, StyleSheet, Text, TouchableOpacity, Alert } from 'react-native';
import MapView, { Marker, Callout } from 'react-native-maps';
import * as Location from 'expo-location';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { supabase } from '../../src/lib/supabase';
import { NearMeResult, CATEGORY_LABELS } from '../../src/types';

export default function MapScreen() {
  const router = useRouter();
  const [region, setRegion] = useState({
    latitude: 22.3193, longitude: 114.1694, // HK default
    latitudeDelta: 0.05, longitudeDelta: 0.05,
  });
  const [items, setItems] = useState<NearMeResult[]>([]);
  const [userLoc, setUserLoc] = useState<{ lat: number; lng: number } | null>(null);
  const [nearMeActive, setNearMeActive] = useState(false);

  useEffect(() => {
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Location needed', 'Enable location to use Near Me.');
        return;
      }
      const loc = await Location.getCurrentPositionAsync({});
      setRegion({
        latitude: loc.coords.latitude,
        longitude: loc.coords.longitude,
        latitudeDelta: 0.05,
        longitudeDelta: 0.05,
      });
      setUserLoc({ lat: loc.coords.latitude, lng: loc.coords.longitude });
    })();
  }, []);

  const loadNearMe = async () => {
    if (!userLoc) return;
    setNearMeActive(true);
    const { data, error } = await supabase.rpc('near_me', {
      lat: userLoc.lat,
      lng: userLoc.lng,
      radius_meters: 5000,
    });
    if (!error && data) setItems(data as NearMeResult[]);
  };

  return (
    <View style={styles.container}>
      <MapView style={styles.map} region={region} onRegionChangeComplete={setRegion} showsUserLocation>
        {items.map((item) => (
          <Marker
            key={item.id}
            coordinate={{
              latitude: item.location.coordinates[1],
              longitude: item.location.coordinates[0],
            }}
            pinColor="#FF6B35"
          >
            <Callout onPress={() => router.push({ pathname: '/item/[id]', params: { id: item.id } })}>
              <View style={styles.callout}>
                <Text style={styles.calloutName}>{item.name_en || item.name_original}</Text>
                <Text style={styles.calloutCategory}>{CATEGORY_LABELS[item.category]}</Text>
                {item.distance_meters && (
                  <Text style={styles.calloutDist}>{Math.round(item.distance_meters)}m away</Text>
                )}
              </View>
            </Callout>
          </Marker>
        ))}
      </MapView>

      {/* Near Me button */}
      <TouchableOpacity
        style={[styles.nearMeBtn, nearMeActive && styles.nearMeActive]}
        onPress={loadNearMe}
      >
        <Ionicons name="locate" size={20} color={nearMeActive ? '#FFF' : '#FF6B35'} />
        <Text style={[styles.nearMeText, nearMeActive && styles.nearMeTextActive]}>
          {nearMeActive ? `${items.length} nearby` : 'Near Me'}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  map: { flex: 1 },
  callout: { padding: 4, maxWidth: 200 },
  calloutName: { fontWeight: '700', fontSize: 14, color: '#1A1A1A' },
  calloutCategory: { fontSize: 12, color: '#FF6B35', marginTop: 2 },
  calloutDist: { fontSize: 11, color: '#8E8E93', marginTop: 2 },
  nearMeBtn: {
    position: 'absolute', top: 16, alignSelf: 'center',
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#FFF', paddingHorizontal: 20, paddingVertical: 12,
    borderRadius: 24, shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1, shadowRadius: 4, elevation: 3,
  },
  nearMeActive: { backgroundColor: '#FF6B35' },
  nearMeText: { fontWeight: '600', fontSize: 14, color: '#FF6B35' },
  nearMeTextActive: { color: '#FFF' },
});
