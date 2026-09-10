import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View, ScrollView } from 'react-native';
import WebView from 'react-native-webview';
import { ref, onValue } from 'firebase/database';
import { db } from '../firebaseConfig';

const statusColors = {
  Normal: '#22c55e',
  'Near Full': '#f59e0b',
  Full: '#ef4444',
};

const parseCoordinateValue = (value) => {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  if (typeof value === 'string') {
    const cleaned = value.trim();
    if (!cleaned) {
      return null;
    }

    const parsed = Number(cleaned.replace(/[^0-9.-]/g, ''));
    return Number.isFinite(parsed) ? parsed : null;
  }

  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

const normalizeBinRecord = (item = {}) => {
  const rawStatus = String(item?.status || item?.state || item?.condition || 'Normal');
  const normalizedStatus = rawStatus.trim().toLowerCase();
  const capacity = Number(
    item?.capacity ?? item?.fillLevel ?? item?.fillPercentage ?? item?.percentage ?? item?.fill ?? 0,
  );

  const status =
    normalizedStatus.includes('critical') || normalizedStatus.includes('full') || normalizedStatus.includes('danger') || capacity >= 85
      ? 'Full'
      : normalizedStatus.includes('warning') || normalizedStatus.includes('near') || normalizedStatus.includes('almost') || normalizedStatus.includes('fair') || capacity >= 60
        ? 'Near Full'
        : normalizedStatus.includes('good') || normalizedStatus.includes('normal') || normalizedStatus.includes('healthy') || normalizedStatus.includes('online')
          ? 'Normal'
          : 'Normal';

  const coordinateSource = Array.isArray(item?.coordinates)
    ? item.coordinates
    : Array.isArray(item?.location)
      ? item.location
      : item?.coordinates || item?.location || item?.position || item?.geo || {};

  let latitude = parseCoordinateValue(
    item?.lat ?? item?.latitude ?? item?.y ??
    (Array.isArray(coordinateSource) ? coordinateSource[0] : coordinateSource?.lat ?? coordinateSource?.latitude ?? null),
  );
  let longitude = parseCoordinateValue(
    item?.lng ?? item?.longitude ?? item?.x ??
    (Array.isArray(coordinateSource) ? coordinateSource[1] : coordinateSource?.lng ?? coordinateSource?.lon ?? coordinateSource?.longitude ?? null),
  );

  if (!Number.isFinite(latitude) && typeof item?.geo === 'object') {
    latitude = parseCoordinateValue(item.geo.lat ?? item.geo.latitude ?? null);
  }
  if (!Number.isFinite(longitude) && typeof item?.geo === 'object') {
    longitude = parseCoordinateValue(item.geo.lng ?? item.geo.lon ?? item.geo.longitude ?? null);
  }

  const addressCandidates = [
    item?.address,
    item?.locationName,
    item?.location?.name,
    item?.location?.address,
    item?.location?.label,
    item?.site,
    item?.place,
    item?.landmark,
    item?.street,
    item?.barangay,
    item?.name,
    item?.binName,
    item?.bin_name,
    typeof item?.location === 'string' ? item.location : null,
    item?.coordinates?.address,
    item?.geo?.address,
  ];

  const resolvedAddress = addressCandidates.find((value) => typeof value === 'string' && value.trim()) || 'Unknown location';

  return {
    id: String(item?.id ?? item?.binId ?? item?.bin_id ?? item?.binID ?? item?.binCode ?? item?.name ?? 'BIN-00'),
    latitude: Number.isFinite(latitude) ? latitude : null,
    longitude: Number.isFinite(longitude) ? longitude : null,
    address: resolvedAddress,
    status,
    capacity: Number.isFinite(capacity) ? capacity : 0,
    lastCollection: item?.lastCollection ?? item?.updatedAt ?? item?.lastUpdated ?? 'Recently',
  };
};

const getStatusColor = (status) => statusColors[status] || '#6B7280';

const buildMapHtml = (items) => {
  const validBins = Array.isArray(items)
    ? items.filter((bin) => Number.isFinite(bin.latitude) && Number.isFinite(bin.longitude))
    : [];

  const markerScript = validBins
    .map((bin, index) => {
      const key = String(bin.id || `bin-${index}`).replace(/[^a-zA-Z0-9]/g, '');
      const safeAddress = JSON.stringify(String(bin.address || 'Unknown location'));
      const safeStatus = JSON.stringify(String(bin.status || 'Normal'));
      const safeId = JSON.stringify(String(bin.id || `bin-${index}`));
      const safeCapacity = Number(bin.capacity) || 0;
      return `
        const marker${key} = L.marker([${bin.latitude}, ${bin.longitude}], {
          icon: L.divIcon({
            className: 'custom-div-icon',
            html: '<div style="position:relative;width:26px;height:26px;display:flex;align-items:center;justify-content:center;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:${getStatusColor(bin.status)};box-shadow:0 8px 18px rgba(15,23,42,0.24);border:3px solid rgba(255,255,255,0.9);"><div style="width:10px;height:10px;border-radius:50%;background:#ffffff;transform:rotate(45deg);"></div></div>',
            iconSize: [26, 26],
            iconAnchor: [13, 26],
          }),
        }).addTo(map);
        marker${key}.bindPopup('<div class="custom-popup"><div class="popup-badge" style="background:${getStatusColor(bin.status)};">' + ${safeStatus} + '</div><div class="popup-title">' + ${safeId} + '</div><div class="popup-text">' + ${safeAddress} + '</div><div class="popup-meta"><span>Capacity</span><strong>' + ${safeCapacity} + '%</strong></div></div>', { className: 'custom-popup-wrapper' });
        marker${key}.on('click', function () {
          window.ReactNativeWebView.postMessage(JSON.stringify({ id: ${safeId} }));
        });`;
    })
    .join('\n');

  const boundsScript = validBins.length > 1
    ? `const bounds = L.latLngBounds(${validBins.map((bin) => `[${bin.latitude}, ${bin.longitude}]`).join(', ')}); map.fitBounds(bounds, { padding: [30, 30] });`
    : `map.setView([${validBins[0]?.latitude ?? 10.2962}, ${validBins[0]?.longitude ?? 123.884}], 15);`;

  return `<!DOCTYPE html>
    <html>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
        <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
        <style>
          html, body, #map { margin: 0; width: 100%; height: 100%; background: #e5e7eb; }
          body { font-family: sans-serif; }
          .leaflet-container { background: #e5e7eb; }
          .leaflet-control-zoom {
            border: none !important;
            border-radius: 14px !important;
            overflow: hidden;
            box-shadow: 0 12px 25px rgba(15, 23, 42, 0.18) !important;
          }
          .leaflet-control-zoom a {
            color: #0f172a !important;
            background: rgba(255,255,255,0.92) !important;
            width: 34px !important;
            height: 34px !important;
            line-height: 34px !important;
            font-size: 18px !important;
          }
          .leaflet-control-attribution {
            background: rgba(15, 23, 42, 0.72) !important;
            color: #e2e8f0 !important;
            border-radius: 10px 0 0 0;
            padding: 4px 8px !important;
          }
          .leaflet-control-attribution a {
            color: #bfdbfe !important;
          }
          .leaflet-popup-content-wrapper {
            background: rgba(15, 23, 42, 0.97);
            border-radius: 18px;
            box-shadow: 0 18px 35px rgba(15, 23, 42, 0.28);
            border: 1px solid rgba(148, 163, 184, 0.18);
            overflow: hidden;
          }
          .leaflet-popup-tip {
            background: rgba(15, 23, 42, 0.97);
          }
          .custom-popup {
            min-width: 190px;
            padding: 6px 2px 2px;
            color: #f8fafc;
          }
          .popup-badge {
            display: inline-block;
            padding: 4px 10px;
            border-radius: 999px;
            font-size: 11px;
            font-weight: 700;
            color: #ffffff;
            margin-bottom: 8px;
            letter-spacing: 0.03em;
          }
          .popup-title {
            font-size: 19px;
            font-weight: 800;
            color: #f8fafc;
            margin-bottom: 6px;
            letter-spacing: 0.02em;
          }
          .popup-text {
            font-size: 13px;
            color: #dbeafe;
            line-height: 1.5;
            margin-bottom: 10px;
          }
          .popup-meta {
            display: flex;
            align-items: center;
            justify-content: space-between;
            border-top: 1px solid rgba(148, 163, 184, 0.18);
            padding-top: 8px;
            font-size: 12px;
            color: #dbeafe;
          }
          .popup-meta strong {
            color: #f8fafc;
            font-size: 13px;
          }
        </style>
      </head>
      <body>
        <div id="map"></div>
        <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
        <script>
          const map = L.map('map', { zoomControl: true, attributionControl: true });
          L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 19,
            attribution: '&copy; OpenStreetMap contributors'
          }).addTo(map);
          ${markerScript}
          ${boundsScript}
          setTimeout(function () {
            try { map.invalidateSize(); } catch (error) {}
          }, 300);
        </script>
      </body>
    </html>`;
};

export default function MapPage() {
  const [bins, setBins] = useState([]);
  const [selectedBinId, setSelectedBinId] = useState(null);

  useEffect(() => {
    const binsRef = ref(db, 'bins');
    const unsubscribe = onValue(binsRef, (snapshot) => {
      const data = snapshot.val();
      const rawList = data ? Object.entries(data).map(([key, value]) => ({ key, ...((value || {})) })) : [];
      const list = rawList
        .map((entry) => normalizeBinRecord({ ...entry, id: entry.id || entry.key }))
        .filter((bin) => Number.isFinite(bin.latitude) && Number.isFinite(bin.longitude));

      setBins(list);
      if (!selectedBinId && list.length) {
        setSelectedBinId(list[0].id);
      }
    });

    return () => unsubscribe();
  }, [selectedBinId]);

  const selectedBin = useMemo(
    () => bins.find((bin) => bin.id === selectedBinId) || bins[0] || null,
    [bins, selectedBinId],
  );

  const handleMapMessage = (event) => {
    try {
      const payload = JSON.parse(event.nativeEvent.data || '{}');
      if (payload && payload.id) {
        setSelectedBinId(payload.id);
      }
    } catch (error) {
      // Ignore invalid payloads from the map.
    }
  };

  return (
    <View style={styles.container}>
      <WebView
        originWhitelist={['*']}
        source={{ html: buildMapHtml(bins) }}
        style={styles.webView}
        javaScriptEnabled
        domStorageEnabled
        onMessage={handleMapMessage}
      />

      <View style={styles.legendContainer}>
        <Text style={styles.legendTitle}>Bin Status</Text>
        {Object.entries(statusColors).map(([label, color]) => (
          <View key={label} style={styles.legendItem}>
            <View style={[styles.statusDot, { backgroundColor: color }]} />
            <Text style={styles.legendLabel}>{label}</Text>
          </View>
        ))}
      </View>

      {!bins.length && (
        <View style={styles.emptyState}>
          <Text style={styles.emptyTitle}>No bins found</Text>
          <Text style={styles.emptyText}>Live Firebase bin data is not available yet.</Text>
        </View>
      )}

      {selectedBin && (
        <View style={styles.detailsPanel}>
          <View style={styles.detailsHeader}>
            <View style={[styles.statusBadge, { backgroundColor: getStatusColor(selectedBin.status) }]}>
              <Text style={styles.statusText}>{selectedBin.status}</Text>
            </View>
            <Text style={styles.binIdText}>{selectedBin.id}</Text>
          </View>

          <ScrollView style={styles.detailsContent} showsVerticalScrollIndicator={false}>
            <Text style={styles.detailLabel}>{selectedBin.address}</Text>
            <View style={styles.capacityRow}>
              <Text style={styles.detailHeading}>Capacity</Text>
              <Text style={styles.capacityValue}>{selectedBin.capacity}%</Text>
            </View>
            <View style={styles.capacityRow}>
              <Text style={styles.detailHeading}>Last collection</Text>
              <Text style={styles.capacityValue}>{selectedBin.lastCollection}</Text>
            </View>
          </ScrollView>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
  webView: {
    flex: 1,
    backgroundColor: '#f3f4f6',
  },
  legendContainer: {
    position: 'absolute',
    top: 18,
    left: 18,
    backgroundColor: '#ffffff',
    borderRadius: 15,
    padding: 12,
    width: 170,
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 6,
  },
  legendTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 8,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  statusDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    marginRight: 8,
  },
  legendLabel: {
    fontSize: 13,
    color: '#4b5563',
    fontWeight: '600',
  },
  detailsPanel: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#ffffff',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 16,
    maxHeight: 260,
    elevation: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -3 },
    shadowOpacity: 0.12,
    shadowRadius: 10,
  },
  detailsHeader: {
    marginBottom: 8,
  },
  statusBadge: {
    alignSelf: 'flex-start',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginBottom: 6,
  },
  statusText: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: 12,
  },
  binIdText: {
    fontSize: 20,
    fontWeight: '700',
    color: '#111827',
  },
  detailsContent: {
    maxHeight: 160,
  },
  detailLabel: {
    color: '#4b5563',
    fontSize: 14,
    marginBottom: 10,
  },
  detailHeading: {
    fontWeight: '700',
    color: '#111827',
    fontSize: 14,
  },
  capacityRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 10,
  },
  capacityValue: {
    color: '#111827',
    fontWeight: '700',
    fontSize: 14,
  },
  emptyState: {
    position: 'absolute',
    left: 20,
    right: 20,
    bottom: 20,
    backgroundColor: '#ffffff',
    borderRadius: 14,
    padding: 18,
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
  },
  emptyTitle: {
    color: '#111827',
    fontWeight: '700',
    fontSize: 16,
    marginBottom: 4,
  },
  emptyText: {
    color: '#4b5563',
    fontSize: 13,
  },
});
