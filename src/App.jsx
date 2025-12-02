import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { MapContainer, TileLayer, Marker, Polyline, useMapEvents, CircleMarker } from 'react-leaflet';
import L from 'leaflet';
import pinIconUrl from './assets/pin.png';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler
} from 'chart.js';
import { Line } from 'react-chartjs-2';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, Filler);

const ELEVATION_API_URL = "https://api.open-elevation.com/api/v1/lookup";
const NOMINATIM_SEARCH_URL = "https://nominatim.openstreetmap.org/search";

// Hàm tính khoảng cách giữa 2 điểm (Haversine formula)
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const φ1 = lat1 * Math.PI / 180;
  const φ2 = lat2 * Math.PI / 180;
  const Δφ = (lat2 - lat1) * Math.PI / 180;
  const Δλ = (lon2 - lon1) * Math.PI / 180;

  const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
          Math.cos(φ1) * Math.cos(φ2) *
          Math.sin(Δλ/2) * Math.sin(Δλ/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

  return R * c;
}

// Hàm tạo các điểm trung gian dọc đường thẳng
function interpolatePoints(start, end, numPoints = 50) {
  const points = [];
  for (let i = 0; i <= numPoints; i++) {
    const ratio = i / numPoints;
    const lat = start.lat + (end.lat - start.lat) * ratio;
    const lng = start.lng + (end.lng - start.lng) * ratio;
    points.push({ lat, lng });
  }
  return points;
}

// Component biểu đồ mặt cắt độ cao
function ElevationChart({ data, distance, onPointClick }) {
  if (!data || data.length === 0) return null;

  const chartRef = useRef(null);

  const distances = data.map((_, index) => (distance * index / (data.length - 1)).toFixed(0));

  const chartData = {
    labels: distances,
    datasets: [
      {
        label: 'Độ cao (mét)',
        data: data.map(point => point.elevation),
        borderColor: 'rgb(34, 139, 34)',
        backgroundColor: 'rgba(34, 139, 34, 0.3)',
        fill: true,
        tension: 0.3,
        pointRadius: 0,
        pointHitRadius: 8,
        pointHoverRadius: 6,
        borderWidth: 2,
      },
    ],
  };

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { 
        display: true,
        position: 'top',
        labels: {
          font: { size: 14 },
          padding: 15
        }
      },
      title: { 
        display: true, 
        text: 'Mặt cắt địa hình',
        font: { size: 18, weight: 'bold' },
        padding: { top: 10, bottom: 20 }
      },
      tooltip: {
        callbacks: {
          title: (context) => `Khoảng cách: ${context[0].label}m`,
          label: (context) => `Độ cao: ${context.parsed.y.toFixed(1)}m`
        },
        bodyFont: { size: 14 },
        titleFont: { size: 14 },
        padding: 12
      }
    },
    scales: {
      x: { 
        title: { 
          display: true, 
          text: 'Khoảng cách (mét)',
          font: { size: 14, weight: 'bold' }
        },
        grid: { color: 'rgba(0,0,0,0.05)' },
        ticks: { font: { size: 12 } }
      },
      y: { 
        title: { 
          display: true, 
          text: 'Độ cao (mét)',
          font: { size: 14, weight: 'bold' }
        },
        grid: { color: 'rgba(0,0,0,0.1)' },
        beginAtZero: false,
        ticks: { font: { size: 12 } }
      }
    }
  };

  const handleChartClick = useCallback((event) => {
    const chart = chartRef.current;
    if (!chart) return;

    // Allow click selection even when points are hidden by using nearest mode without intersection
    const elements = chart.getElementsAtEventForMode(
      event.native ?? event,
      'nearest',
      { intersect: false },
      true
    );

    if (elements && elements.length > 0) {
      const idx = elements[0].index;
      if (typeof idx === 'number') {
        onPointClick?.(idx);
      }
    }
  }, [onPointClick]);

  return (
    <div style={{height: '100%', width: '100%'}}>
      <Line 
        options={options} 
        data={chartData} 
        ref={chartRef}
        onClick={handleChartClick}
      />
    </div>
  );
}

// Component xử lý click trên bản đồ
function MapClickHandler({ setPoints, points, getElevationPath, setElevationProfile, setStatusText, setDistance }) {
  useMapEvents({
    click(e) {
      const latLng = e.latlng;

      if (points.length === 0) {
        setPoints([latLng]);
        setElevationProfile([]);
        setDistance(0);
        setStatusText("✅ Đã chọn điểm A. Nhấp tiếp để chọn điểm B.");
      } else if (points.length === 1) {
        const newPath = [points[0], latLng];
        setPoints(newPath);
        
        const dist = calculateDistance(
          points[0].lat, points[0].lng,
          latLng.lat, latLng.lng
        );
        setDistance(dist);
        
        getElevationPath(newPath, dist);
      } else {
        setPoints([latLng]);
        setElevationProfile([]);
        setDistance(0);
        setStatusText("🔄 Đã reset. Chọn điểm A mới...");
      }
    },
  });
  return null;
}

// App chính
function App() {
  const [points, setPoints] = useState([]);
  const [elevationProfile, setElevationProfile] = useState([]);
  const [distance, setDistance] = useState(0);
  const [statusText, setStatusText] = useState("📍 Nhấp chuột trên bản đồ để chọn điểm A");
  const [isLoading, setIsLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [suggestions, setSuggestions] = useState([]);
  const [searchMarker, setSearchMarker] = useState(null);
  const [searchError, setSearchError] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [isFetchingSuggestions, setIsFetchingSuggestions] = useState(false);
  const [showEsriLabels, setShowEsriLabels] = useState(true);
  const [profileCoords, setProfileCoords] = useState([]);
  const [selectedProfileIndex, setSelectedProfileIndex] = useState(null);
  const mapRef = useRef(null);
  const pinIcon = useMemo(() => L.icon({
    iconUrl: pinIconUrl,
    iconSize: [32, 44], // scale the 192x262 asset down to a reasonable marker size
    iconAnchor: [16, 44],
    popupAnchor: [0, -38],
    tooltipAnchor: [0, -38]
  }), []);

  useEffect(() => {
    const trimmed = searchQuery.trim();
    if (trimmed.length < 3) {
      setSuggestions([]);
      setIsFetchingSuggestions(false);
      return;
    }

    const controller = new AbortController();
    setIsFetchingSuggestions(true);

    const handler = setTimeout(async () => {
      try {
        const response = await fetch(
          `${NOMINATIM_SEARCH_URL}?format=json&q=${encodeURIComponent(trimmed)}&addressdetails=1&limit=5`,
          {
            signal: controller.signal,
            headers: {
              Accept: "application/json",
              "User-Agent": "react-elevation-tool/1.0"
            }
          }
        );

        if (!response.ok) {
          throw new Error("Nominatim suggestion request failed");
        }

        const data = await response.json();
        if (!controller.signal.aborted) {
          setSuggestions(Array.isArray(data) ? data : []);
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          console.error("Suggestion fetch error:", error);
          setSuggestions([]);
        }
      } finally {
        if (!controller.signal.aborted) {
          setIsFetchingSuggestions(false);
        }
      }
    }, 350);

    return () => {
      clearTimeout(handler);
      controller.abort();
    };
  }, [searchQuery]);

  const handleSearch = useCallback(async (queryText) => {
    const query = (queryText ?? searchQuery).trim();
    if (!query) {
      setSearchError("Nhập địa điểm cần tìm.");
      return;
    }

    setIsSearching(true);
    setSearchError("");

    try {
      const response = await fetch(
        `${NOMINATIM_SEARCH_URL}?format=json&q=${encodeURIComponent(query)}&addressdetails=1&limit=1`,
        {
          headers: {
            Accept: "application/json",
            "User-Agent": "react-elevation-tool/1.0"
          }
        }
      );

      const data = await response.json();

      if (response.ok && Array.isArray(data) && data.length > 0) {
        const { lat, lon, display_name } = data[0];
        const latNum = parseFloat(lat);
        const lonNum = parseFloat(lon);

        setSearchMarker({ lat: latNum, lng: lonNum, label: display_name });
        setSuggestions([]);

        if (mapRef.current) {
          const nextZoom = Math.max(mapRef.current.getZoom(), 13);
          mapRef.current.setView([latNum, lonNum], nextZoom);
        }
      } else {
        setSearchError("Không tìm thấy địa điểm phù hợp.");
      }
    } catch (error) {
      console.error("Search error:", error);
      setSearchError("Không thể tìm kiếm lúc này, thử lại sau.");
    } finally {
      setIsSearching(false);
    }
  }, [searchQuery]);

  const handleSuggestionSelect = (item) => {
    setSearchQuery(item.display_name);
    handleSearch(item.display_name);
  };
  

  const getElevationPath = useCallback(async (path, totalDistance) => {
    setIsLoading(true);
    setStatusText("⏳ Đang tính toán độ cao...");

    const interpolated = interpolatePoints(path[0], path[1], 50);
    setProfileCoords(interpolated);
    setSelectedProfileIndex(null);
    
    const locations = interpolated.map(p => ({
      latitude: p.lat,
      longitude: p.lng
    }));

    try {
      const response = await fetch(ELEVATION_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ locations })
      });
      
      const data = await response.json();

      if (response.ok && data.results) {
        setElevationProfile(data.results);
        const startElev = data.results[0].elevation;
        const endElev = data.results[data.results.length - 1].elevation;
        const maxElev = Math.max(...data.results.map(r => r.elevation));
        const minElev = Math.min(...data.results.map(r => r.elevation));
        
        setStatusText(
          `✅ Hoàn tất! Khoảng cách: ${(totalDistance/1000).toFixed(2)}km | ` +
          `Độ cao: ${startElev.toFixed(0)}m → ${endElev.toFixed(0)}m | ` +
          `Cao nhất: ${maxElev.toFixed(0)}m | Thấp nhất: ${minElev.toFixed(0)}m`
        );
      } else {
        setStatusText("❌ Lỗi khi lấy dữ liệu độ cao.");
        setElevationProfile([]);
        setProfileCoords([]);
        setSelectedProfileIndex(null);
      }
    } catch (error) {
      setStatusText("❌ Lỗi kết nối API.");
      setElevationProfile([]);
      setProfileCoords([]);
      setSelectedProfileIndex(null);
      console.error("Fetch error:", error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const handleProfilePointClick = useCallback((idx) => {
    if (!profileCoords[idx]) return;
    setSelectedProfileIndex(idx);
  }, [profileCoords]);

  const handleReset = () => {
    setPoints([]);
    setElevationProfile([]);
    setDistance(0);
    setStatusText("📍 Đã xóa. Nhấp chuột để chọn điểm A mới.");
    setProfileCoords([]);
    setSelectedProfileIndex(null);
  };

  return (
    <div style={{ 
      display: 'flex',
      height: '100vh', 
      width: '100%',
      overflow: 'hidden'
    }}>
      {/* Bản đồ bên trái - 2/3 màn hình */}
      <div style={{ 
        width: '66.66%',
        height: '100%',
        position: 'relative'
      }}>
        <MapContainer 
          center={[21.0285, 105.8542]}
          zoom={10} 
          style={{ height: '100%', width: '100%' }}
          whenCreated={(map) => { mapRef.current = map; }}
        >
          {/* Ảnh vệ tinh Esri */}
          <TileLayer
            attribution='Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community'
            url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
          />
          {/* Lớp phủ nhãn Esri có thể bật/tắt */}
          {showEsriLabels && (
            // <TileLayer
            //   attribution='Labels &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community'
            //   url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}"
            //   pane="overlayPane"
            //   opacity={0.4}
            // />
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              pane="overlayPane"
              opacity={0.7}
/>
          )}

          <MapClickHandler 
            setPoints={setPoints} 
            points={points} 
            getElevationPath={getElevationPath} 
            setElevationProfile={setElevationProfile} 
            setStatusText={setStatusText}
            setDistance={setDistance}
          />

          {searchMarker && (
            <Marker position={[searchMarker.lat, searchMarker.lng]} icon={pinIcon} />
          )}

          {points.map((p, idx) => (
            <Marker 
              key={idx} 
              position={p}
              icon={pinIcon}
            />
          ))}

          {points.length === 2 && (
            <Polyline positions={points} color="#ff4444" weight={3} opacity={0.8} />
          )}

          {selectedProfileIndex !== null && profileCoords[selectedProfileIndex] && (
            <CircleMarker
              center={[profileCoords[selectedProfileIndex].lat, profileCoords[selectedProfileIndex].lng]}
              radius={8}
              pathOptions={{ color: '#1e88e5', fillColor: '#1e88e5', fillOpacity: 0.85, weight: 2 }}
            />
          )}
        </MapContainer>
      </div>

      {/* Panel bên phải - 1/3 màn hình */}
      <div style={{
        width: '33.34%',
        height: '100%',
        background: '#f8f9fa',
        display: 'flex',
        flexDirection: 'column',
        overflowY: 'auto'
      }}>
        {/* Header */}
        <div style={{
          background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
          color: 'white',
          padding: '40px 45px',
          boxShadow: '0 4px 6px rgba(0,0,0,0.1)'
        }}>
          <h2 style={{ 
            margin: 0, 
            fontSize: '36px', 
            fontWeight: 'bold',
            marginBottom: '15px'
          }}>
            🗻 Công cụ đo mặt cắt
          </h2>
          <p style={{ 
            margin: 0, 
            fontSize: '20px', 
            opacity: 0.9,
            lineHeight: '1.4'
          }}>
            Nhấp vào bản đồ để chọn 2 điểm
          </p>
        </div>

        {/* Thanh tìm kiếm */}
        <div style={{
          padding: '45px 40px',
          background: 'white',
          borderBottom: '2px solid #e0e0e0'
        }}>
          <label style={{
            display: 'block',
            fontSize: '22px',
            fontWeight: '700',
            marginBottom: '15px',
            color: '#333'
          }}>
            🔍 Tìm kiếm địa điểm
          </label>
          <div style={{ position: 'relative' }}>
            <input
              type="text"
              value={searchQuery}
              placeholder="Nhập tên địa điểm..."
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setSearchError("");
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleSearch();
                }
              }}
              style={{
                width: '100%',
                padding: '20px 25px',
                fontSize: '20px',
                border: '3px solid #e0e0e0',
                borderRadius: '12px',
                outline: 'none',
                transition: 'border-color 0.2s',
                boxSizing: 'border-box'
              }}
              onFocus={(e) => e.target.style.borderColor = '#667eea'}
              onBlur={(e) => e.target.style.borderColor = '#e0e0e0'}
            />

            {suggestions.length > 0 && (
              <div style={{
                position: 'absolute',
                top: '100%',
                left: 0,
                right: 0,
                background: 'white',
                border: '1px solid #e0e0e0',
                borderRadius: '12px',
                marginTop: '8px',
                boxShadow: '0 8px 20px rgba(0,0,0,0.12)',
                maxHeight: '220px',
                overflowY: 'auto',
                zIndex: 20
              }}>
                {suggestions.map((item) => (
                  <div
                    key={item.place_id}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => handleSuggestionSelect(item)}
                    style={{
                      padding: '12px 14px',
                      cursor: 'pointer',
                      borderBottom: '1px solid #f1f1f1',
                      fontSize: '16px',
                      color: '#333',
                      background: '#fff'
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.background = '#f6f8ff'}
                    onMouseLeave={(e) => e.currentTarget.style.background = '#fff'}
                  >
                    <div style={{ fontWeight: 600 }}>
                      {item.display_name?.split(',')[0] || 'Kết quả'}
                    </div>
                    <div style={{ fontSize: '13px', color: '#777', marginTop: '3px' }}>
                      {item.display_name}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <button
            onClick={() => handleSearch()}
            disabled={isSearching}
            style={{
              marginTop: '16px',
              padding: '16px 20px',
              background: '#667eea',
              color: 'white',
              border: 'none',
              borderRadius: '12px',
              cursor: isSearching ? 'not-allowed' : 'pointer',
              fontWeight: 'bold',
              fontSize: '18px',
              width: '100%',
              boxShadow: '0 4px 8px rgba(0,0,0,0.12)',
              opacity: isSearching ? 0.7 : 1,
              transition: 'all 0.2s ease'
            }}
            onMouseEnter={(e) => {
              if (!isSearching) {
                e.target.style.background = '#5568d3';
                e.target.style.transform = 'translateY(-1px)';
                e.target.style.boxShadow = '0 6px 12px rgba(0,0,0,0.2)';
              }
            }}
            onMouseLeave={(e) => {
              e.target.style.background = '#667eea';
              e.target.style.transform = 'translateY(0)';
              e.target.style.boxShadow = '0 4px 8px rgba(0,0,0,0.12)';
            }}
          >
            {isSearching ? 'Đang tìm...' : 'Tìm & hiển thị'}
          </button>

          {isFetchingSuggestions && (
            <div style={{ marginTop: '10px', fontSize: '14px', color: '#666' }}>
              Đang gợi ý tìm kiếm...
            </div>
          )}

          {searchError && (
            <div style={{ marginTop: '12px', color: '#d32f2f', fontSize: '15px', fontWeight: 600 }}>
              {searchError}
            </div>
          )}

          <p style={{
            margin: '15px 0 0 0',
            fontSize: '18px',
            color: '#666',
            fontStyle: 'italic'
          }}>
            Hoặc nhấp trực tiếp vào bản đồ
          </p>
        </div>

        {/* Điều khiển lớp nền */}
        <div style={{
          padding: '30px 40px',
          background: 'white',
          borderBottom: '2px solid #e0e0e0'
        }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '12px'
          }}>
            <div>
              <div style={{ fontSize: '18px', fontWeight: '700', color: '#333' }}>
                Lớp nhãn Esri
              </div>
              <div style={{ fontSize: '14px', color: '#666', marginTop: '4px' }}>
                Bật hoặc tắt lớp nhãn đường phố phủ trên ảnh vệ tinh.
              </div>
            </div>
            <button
              onClick={() => setShowEsriLabels((prev) => !prev)}
              style={{
                padding: '12px 18px',
                minWidth: '170px',
                background: showEsriLabels ? '#43a047' : '#9e9e9e',
                color: 'white',
                border: 'none',
                borderRadius: '12px',
                cursor: 'pointer',
                fontWeight: 'bold',
                fontSize: '16px',
                boxShadow: '0 4px 10px rgba(0,0,0,0.12)',
                transition: 'all 0.2s ease'
              }}
              onMouseEnter={(e) => {
                e.target.style.transform = 'translateY(-1px)';
                e.target.style.boxShadow = '0 6px 12px rgba(0,0,0,0.2)';
              }}
              onMouseLeave={(e) => {
                e.target.style.transform = 'translateY(0)';
                e.target.style.boxShadow = '0 4px 10px rgba(0,0,0,0.12)';
              }}
            >
              {showEsriLabels ? 'Tắt lớp nhãn' : 'Bật lớp nhãn'}
            </button>
          </div>
        </div>

        {/* Trạng thái */}
        <div style={{
          padding: '45px 40px',
          background: 'white',
          borderBottom: '2px solid #e0e0e0'
        }}>
          <div style={{
            padding: '30px',
            background: points.length === 0 ? '#e3f2fd' : points.length === 1 ? '#fff3e0' : '#e8f5e9',
            borderRadius: '12px',
            borderLeft: `6px solid ${points.length === 0 ? '#2196f3' : points.length === 1 ? '#ff9800' : '#4caf50'}`
          }}>
            <div style={{
              fontSize: '24px',
              fontWeight: '700',
              color: '#555',
              marginBottom: '12px'
            }}>
              {points.length === 0 ? '📍 Bước 1: Chọn điểm A' : points.length === 1 ? '📍 Bước 2: Chọn điểm B' : '✅ Hoàn tất'}
            </div>
            <div style={{
              fontSize: '20px',
              color: '#333',
              lineHeight: '1.6'
            }}>
              {statusText}
            </div>
          </div>
          
          {points.length === 2 && (
            <button 
              onClick={handleReset}
              disabled={isLoading}
              style={{
                width: '100%',
                marginTop: '25px',
                padding: '20px 30px',
                background: '#667eea',
                color: 'white',
                border: 'none',
                borderRadius: '12px',
                cursor: isLoading ? 'not-allowed' : 'pointer',
                fontWeight: 'bold',
                fontSize: '22px',
                boxShadow: '0 4px 8px rgba(0,0,0,0.15)',
                transition: 'all 0.2s',
                opacity: isLoading ? 0.6 : 1
              }}
              onMouseEnter={(e) => {
                if (!isLoading) {
                  e.target.style.background = '#5568d3';
                  e.target.style.transform = 'translateY(-2px)';
                  e.target.style.boxShadow = '0 6px 12px rgba(0,0,0,0.2)';
                }
              }}
              onMouseLeave={(e) => {
                e.target.style.background = '#667eea';
                e.target.style.transform = 'translateY(0)';
                e.target.style.boxShadow = '0 4px 8px rgba(0,0,0,0.15)';
              }}
            >
              🔄 Đo đoạn mới
            </button>
          )}
        </div>

        {/* Biểu đồ */}
        {elevationProfile.length > 0 && (
          <div style={{
            flex: 1,
            padding: '20px 25px',
            background: 'white',
            display: 'flex',
            flexDirection: 'column',
            minHeight: '400px'
          }}>
            <h3 style={{
              margin: '0 0 15px 0',
              fontSize: '18px',
              fontWeight: 'bold',
              color: '#333'
            }}>
              📊 Biểu đồ mặt cắt địa hình
            </h3>
            <div style={{ flex: 1, minHeight: '300px' }}>
              <ElevationChart 
                data={elevationProfile} 
                distance={distance} 
                onPointClick={handleProfilePointClick}
              />
            </div>
          </div>
        )}

        {/* Thông tin hướng dẫn khi chưa có dữ liệu */}
        {elevationProfile.length === 0 && (
          <div style={{
            flex: 1,
            padding: '60px 40px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            textAlign: 'center'
          }}>
            <div>
              <div style={{ fontSize: '96px', marginBottom: '30px' }}>🗺️</div>
              <h3 style={{ 
                margin: '0 0 20px 0',
                fontSize: '28px',
                color: '#333',
                fontWeight: 'bold'
              }}>
                Bắt đầu đo mặt cắt địa hình
              </h3>
              <p style={{
                margin: 0,
                fontSize: '20px',
                color: '#666',
                lineHeight: '1.8'
              }}>
                Nhấp vào bản đồ để chọn điểm A và điểm B.<br/>
                Biểu đồ mặt cắt sẽ hiển thị ở đây.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
