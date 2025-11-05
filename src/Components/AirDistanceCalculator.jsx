import { useState, useRef, useEffect } from 'react';
import Papa from 'papaparse';
import './AirDistanceCalculator.css';

export default function AirDistanceCalculator() {
  const [fromCity, setFromCity] = useState({ name: 'Delhi, India', lat: 28.6139, lon: 77.2090 });
  const [toCity, setToCity] = useState({ name: 'Goa, India', lat: 15.2993, lon: 74.1240 });
  const [distance, setDistance] = useState(null);
  const [mode, setMode] = useState('search');
  const [searchQuery, setSearchQuery] = useState({ from: '', to: '' });
  const [suggestions, setSuggestions] = useState({ from: [], to: [] });
  const [loading, setLoading] = useState({ from: false, to: false });
  const [bulkMode, setBulkMode] = useState(false);
  const [bulkData, setBulkData] = useState([]);
  const [bulkResults, setBulkResults] = useState([]);
  const [processing, setProcessing] = useState(false);
  const [travelMode, setTravelMode] = useState('air');
  const [bulkTravelMode, setBulkTravelMode] = useState('air'); // Default to air for speed
  const [roadDistance, setRoadDistance] = useState(null);
  const [roadDuration, setRoadDuration] = useState(null);
  const [calculatingRoad, setCalculatingRoad] = useState(false);
  const [roadError, setRoadError] = useState(null);
  const [processProgress, setProcessProgress] = useState({ current: 0, total: 0, phase: 'parsing' }); // Added phase for better UX
  const [geocodeCache, setGeocodeCache] = useState({}); // Simple in-memory cache for session

  // Worker ref for non-blocking processing (optional, can be enabled)
  const workerRef = useRef(null);

  // Cleanup worker on unmount
  useEffect(() => {
    return () => {
      if (workerRef.current) {
        workerRef.current.terminate();
      }
    };
  }, []);

  const calculateDistance = (lat1, lon1, lat2, lon2) => {
    const R = 6371; // Earth's radius in km
    const toRad = (deg) => (deg * Math.PI) / 180;
    
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    
    const a = 
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  };

  // Cache helper for geocoding (in-memory for session)
  const getCachedCoords = (name) => geocodeCache[name];
  const setCachedCoords = (name, coords) => {
    setGeocodeCache(prev => ({ ...prev, [name]: coords }));
  };

  const fetchCities = async (query, type) => {
    if (query.length < 2) {
      setSuggestions(prev => ({ ...prev, [type]: [] }));
      return;
    }

    setLoading(prev => ({ ...prev, [type]: true }));

    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&limit=6&q=${encodeURIComponent(query)}&addressdetails=1`
      );
      const data = await res.json();

      if (data && data.length > 0) {
        const cities = data.map(place => ({
          name: place.display_name.split(',')[0],
          country: place.address?.country || '',
          state: place.address?.state || place.address?.city || place.address?.suburb || '',
          lat: parseFloat(place.lat),
          lon: parseFloat(place.lon),
          display: place.display_name
        }));
        setSuggestions(prev => ({ ...prev, [type]: cities }));
      } else {
        setSuggestions(prev => ({ ...prev, [type]: [] }));
      }
    } catch (err) {
      console.error('Failed to fetch cities:', err);
      setSuggestions(prev => ({ ...prev, [type]: [] }));
    } finally {
      setLoading(prev => ({ ...prev, [type]: false }));
    }
  };

  const selectCity = (city, type) => {
    const cityData = { name: city.display, lat: city.lat, lon: city.lon };
    if (type === 'from') {
      setFromCity(cityData);
      setSearchQuery(prev => ({ ...prev, from: '' }));
      setSuggestions(prev => ({ ...prev, from: [] }));
    } else {
      setToCity(cityData);
      setSearchQuery(prev => ({ ...prev, to: '' }));
      setSuggestions(prev => ({ ...prev, to: [] }));
    }
    setDistance(null);
    setRoadDistance(null);
    setRoadDuration(null);
    setRoadError(null);
  };

  const handleCustomInput = (type, field, value) => {
    const parsedValue = field === 'name' ? value : parseFloat(value) || 0;
    if (type === 'from') {
      setFromCity(prev => ({ ...prev, [field]: parsedValue }));
    } else {
      setToCity(prev => ({ ...prev, [field]: parsedValue }));
    }
    setDistance(null);
    setRoadDistance(null);
    setRoadDuration(null);
    setRoadError(null);
  };

  const fetchRoadDistance = async (fromLat, fromLon, toLat, toLon) => {
    try {
      const response = await fetch(
        `https://router.project-osrm.org/route/v1/driving/${fromLon},${fromLat};${toLon},${toLat}?overview=false`
      );
      
      if (!response.ok) {
        throw new Error('Routing service unavailable');
      }
      
      const data = await response.json();
      
      if (data.code === 'Ok' && data.routes && data.routes[0]) {
        const route = data.routes[0];
        return {
          distance: route.distance / 1000,
          duration: route.duration / 60
        };
      } else {
        return null;
      }
    } catch (err) {
      console.error('Road routing error:', err);
      return null;
    }
  };

  const handleCalculate = async () => {
    const dist = calculateDistance(fromCity.lat, fromCity.lon, toCity.lat, toCity.lon);
    setDistance(dist);

    if (travelMode === 'road') {
      setCalculatingRoad(true);
      setRoadDistance(null);
      setRoadDuration(null);
      setRoadError(null);

      const roadData = await fetchRoadDistance(fromCity.lat, fromCity.lon, toCity.lat, toCity.lon);
      
      if (roadData) {
        setRoadDistance(roadData.distance);
        setRoadDuration(roadData.duration);
      } else {
        setRoadError('Unable to calculate road distance. The locations may be too far apart, not connected by road, or separated by water.');
      }
      
      setCalculatingRoad(false);
    }
  };

  // Optimized bulk geocoding with cache
  const geocodeBulk = async (locationName) => {
    if (!locationName) return null;
    const cached = getCachedCoords(locationName);
    if (cached) return cached;

    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(locationName)}&addressdetails=1`
      );
      const data = await res.json();
      if (data && data.length > 0) {
        const result = data[0];
        const coords = {
          lat: parseFloat(result.lat),
          lon: parseFloat(result.lon)
        };
        setCachedCoords(locationName, coords);
        return coords;
      }
      return null;
    } catch (err) {
      console.error('Bulk geocoding failed:', err);
      return null;
    }
  };

  // Throttled batch processor for parallel ops
  const processInBatches = async (tasks, batchSize = 5, delayMs = 1000) => {
    const results = [];
    for (let i = 0; i < tasks.length; i += batchSize) {
      const batch = tasks.slice(i, i + batchSize);
      const batchPromises = batch.map(task => task());
      const batchResults = await Promise.allSettled(batchPromises);
      results.push(...batchResults.map(r => r.status === 'fulfilled' ? r.value : null));
      setProcessProgress(prev => ({ ...prev, current: Math.min(prev.total, prev.current + batchSize) }));
      if (i + batchSize < tasks.length) {
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }
    return results;
  };

  // Helper to check if value is numeric coord
  const isNumericCoord = (val) => {
    if (!val) return false;
    const num = parseFloat(val);
    return !isNaN(num) && val.toString().trim() !== '';
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setProcessing(true);
    setProcessProgress({ current: 0, total: 0, phase: 'parsing' });
    setBulkResults([]);

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      dynamicTyping: false,
      transformHeader: (header) => header.trim().toLowerCase(),
      transform: (value, field) => {
        if (field === 'from' || field === 'to') return value?.trim() || '';
        return value;
      },
      complete: async (parseResult) => {
        try {
          let jsonData = parseResult.data;
          
          // Fix malformed CSV rows (e.g., "Delhi,Mumbai" in single column)
          jsonData = jsonData.map(row => {
            const keys = Object.keys(row);
            if (keys.length === 1 && (keys[0].toLowerCase().includes('from') || keys[0].toLowerCase().includes('to') || keys[0] === 'from,to')) {
              const value = row[keys[0]];
              if (value && typeof value === 'string' && value.includes(',')) {
                let cleanValue = value.replace(/"/g, '').trim();
                const parts = cleanValue.split(',').map(p => p.trim());
                if (parts.length === 2) {
                  return { from: parts[0], to: parts[1] };
                } else if (parts.length === 4) {
                  if (parts.every(p => isNumericCoord(p))) {
                    return { 
                      from_lat: parts[0], 
                      from_lon: parts[1], 
                      to_lat: parts[2], 
                      to_lon: parts[3],
                      from: 'Custom Coordinates (From)',
                      to: 'Custom Coordinates (To)'
                    };
                  } else {
                    return { 
                      from: parts[0] + ', ' + parts[1], 
                      to: parts[2] + ', ' + parts[3]
                    };
                  }
                }
              }
            }
            return row;
          });
          
          // Filter empty/invalid rows early
          jsonData = jsonData.filter(row => {
            return (row.from || row.from_lat || row.to || row.to_lat) && 
                   Object.values(row).some(v => v && v.toString().trim() !== '');
          });

          setBulkData(jsonData);
          setProcessProgress({ current: 0, total: jsonData.length * 2, phase: 'geocoding' }); // *2 for from/to
          
          // Collect geocoding tasks for all from/to
          const geocodeTasks = [];
          jsonData.forEach(row => {
            // From task
            geocodeTasks.push(async () => {
              if (row.from_lat && row.from_lon && isNumericCoord(row.from_lat) && isNumericCoord(row.from_lon)) {
                return { lat: parseFloat(row.from_lat), lon: parseFloat(row.from_lon), name: row.from || 'Custom Coordinates' };
              } else if (row.from && !isNumericCoord(row.from)) {
                return await geocodeBulk(row.from);
              }
              return null;
            });

            // To task
            geocodeTasks.push(async () => {
              if (row.to_lat && row.to_lon && isNumericCoord(row.to_lat) && isNumericCoord(row.to_lon)) {
                return { lat: parseFloat(row.to_lat), lon: parseFloat(row.to_lon), name: row.to || 'Custom Coordinates' };
              } else if (row.to && !isNumericCoord(row.to)) {
                return await geocodeBulk(row.to);
              }
              return null;
            });
          });

          // Parallel batch geocoding
          const allGeocodes = await processInBatches(geocodeTasks, 5, 1000); // 5 parallel, 1s throttle

          // Now process rows
          setProcessProgress({ current: 0, total: jsonData.length, phase: bulkTravelMode === 'air' ? 'calculating' : 'routing' });
          const results = [];
          let geocodeIdx = 0;
          for (let i = 0; i < jsonData.length; i++) {
            const row = jsonData[i];
            const fromCoords = allGeocodes[geocodeIdx++];
            const toCoords = allGeocodes[geocodeIdx++];

            let fromLat = fromCoords?.lat, fromLon = fromCoords?.lon, fromName = fromCoords ? (fromCoords.name || row.from || 'Unknown') : (row.from || 'Unknown');
            let toLat = toCoords?.lat, toLon = toCoords?.lon, toName = toCoords ? (toCoords.name || row.to || 'Unknown') : (row.to || 'Unknown');

            const resultRow = {
              ...row,
              from: fromName,
              to: toName,
              from_lat: fromLat ? fromLat.toFixed(4) : '-',
              from_lon: fromLon ? fromLon.toFixed(4) : '-',
              to_lat: toLat ? toLat.toFixed(4) : '-',
              to_lon: toLon ? toLon.toFixed(4) : '-'
            };

            if (fromLat && fromLon && toLat && toLon) {
              if (bulkTravelMode === 'air') {
                const airDist = calculateDistance(fromLat, fromLon, toLat, toLon);
                resultRow.distance_km = airDist.toFixed(2);
                resultRow.distance_miles = (airDist * 0.621371).toFixed(2);
                resultRow.flight_time_hours = (airDist / 800).toFixed(1);
              } else {
                const roadData = await fetchRoadDistance(fromLat, fromLon, toLat, toLon);
                if (roadData) {
                  resultRow.distance_km = roadData.distance.toFixed(2);
                  resultRow.distance_miles = (roadData.distance * 0.621371).toFixed(2);
                  resultRow.drive_time_hours = (roadData.duration / 60).toFixed(1);
                  resultRow.drive_time_minutes = Math.floor(roadData.duration);
                } else {
                  resultRow.distance_km = 'N/A';
                  resultRow.distance_miles = 'N/A';
                  resultRow.drive_time_hours = 'N/A';
                  resultRow.drive_time_minutes = 'N/A';
                  resultRow.error = 'Road route not available';
                }
                await new Promise(resolve => setTimeout(resolve, 300)); // OSRM throttle
              }
            } else {
              resultRow.distance_km = '-';
              resultRow.distance_miles = '-';
              resultRow.error = fromLat && fromLon ? 'To location failed' : (toLat && toLon ? 'From location failed' : 'Could not geocode or parse locations');
              if (bulkTravelMode === 'air') {
                resultRow.flight_time_hours = '-';
              } else {
                resultRow.drive_time_hours = '-';
                resultRow.drive_time_minutes = '-';
              }
            }

            results.push(resultRow);
            setProcessProgress(prev => ({ ...prev, current: i + 1 }));
          }

          setBulkResults(results);
          setProcessProgress({ current: 0, total: 0, phase: 'done' });
          setProcessing(false);
        } catch (err) {
          console.error('File processing error:', err);
          alert('Error processing file. Please check format.');
          setProcessing(false);
        }
      },
      error: (error) => {
        console.error('Parse error:', error);
        alert('Error reading file. Please ensure it is a valid CSV file.');
        setProcessing(false);
      }
    });
  };

  const downloadResults = () => {
    let headers;
    
    if (bulkTravelMode === 'air') {
      headers = ['from', 'to', 'from_lat', 'from_lon', 'to_lat', 'to_lon', 'distance_km', 'distance_miles', 'flight_time_hours'];
    } else {
      headers = ['from', 'to', 'from_lat', 'from_lon', 'to_lat', 'to_lon', 'distance_km', 'distance_miles', 'drive_time_hours', 'drive_time_minutes'];
    }
    
    const csvContent = [
      headers.join(','),
      ...bulkResults.map(row => 
        headers.map(header => {
          let value = row[header];
          if (!value) {
            const capHeader = header.charAt(0).toUpperCase() + header.slice(1);
            value = row[capHeader];
          }
          value = value || '-';
          return typeof value === 'string' && (value.includes(',') || value.includes('"')) 
            ? `"${value.replace(/"/g, '""')}"` 
            : value;
        }).join(',')
      )
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    
    link.setAttribute('href', url);
    link.setAttribute('download', `distance_results_${bulkTravelMode}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="app-container">
      <div className="calculator-wrapper">
        <div className="header">
          <h1>
            <span className="plane-icon">✈️</span>
            Global Distance Calculator
          </h1>
          <p>Calculate air and road distances between any two locations worldwide</p>
        </div>

        <div className="mode-toggle">
          <div className="toggle-buttons">
            <button
              className={`toggle-btn ${!bulkMode && mode === 'search' ? 'active' : ''}`}
              onClick={() => { setBulkMode(false); setMode('search'); }}
            >
              🔍 Search Cities
            </button>
            <button
              className={`toggle-btn ${!bulkMode && mode === 'custom' ? 'active' : ''}`}
              onClick={() => { setBulkMode(false); setMode('custom'); }}
            >
              📍 Custom Coordinates
            </button>
            <button
              className={`toggle-btn ${bulkMode ? 'active' : ''}`}
              onClick={() => setBulkMode(true)}
            >
              📊 Bulk Upload (CSV)
            </button>
          </div>
        </div>

        {!bulkMode ? (
          <div className="travel-mode-selector">
            <label className="mode-label">Travel Mode:</label>
            <div className="mode-buttons">
              <button
                onClick={() => { setTravelMode('air'); setRoadDistance(null); setRoadDuration(null); setRoadError(null); }}
                className={`mode-btn ${travelMode === 'air' ? 'active' : ''}`}
              >
                ✈️ By Air
              </button>
              <button
                onClick={() => setTravelMode('road')}
                className={`mode-btn ${travelMode === 'road' ? 'active' : ''}`}
              >
                🚗 By Road
              </button>
            </div>
          </div>
        ) : (
          <div className="travel-mode-selector">
            <label className="mode-label">Bulk Calculation Mode:</label>
            <div className="mode-buttons">
              <button
                onClick={() => { setBulkTravelMode('air'); setBulkResults([]); }}
                className={`mode-btn ${bulkTravelMode === 'air' ? 'active' : ''}`}
                disabled={processing}
              >
                ✈️ By Air Distance (Faster)
              </button>
              <button
                onClick={() => { setBulkTravelMode('road'); setBulkResults([]); }}
                className={`mode-btn ${bulkTravelMode === 'road' ? 'active' : ''}`}
                disabled={processing}
              >
                🚗 By Road Distance (Slower)
              </button>
            </div>
            <p style={{ textAlign: 'center', color: '#64748b', fontSize: '0.9rem', marginTop: '0.5rem' }}>
              {bulkTravelMode === 'road' ? '⚠️ Road mode: ~5-10x slower (API limits). Use coordinates for speed.' : '✅ Air mode: Quick haversine calc after geocoding.'}
              <br />
              💡 Upload coordinates for 10x faster processing—no geocoding needed!
            </p>
          </div>
        )}

        {bulkMode ? (
          <div className="bulk-upload-section">
            <div className="upload-instructions">
              <h3>📋 CSV File Format</h3>
              <p>Your CSV file should have these columns:</p>
              <ul>
                <li><strong>Option 1:</strong> from, to (city names or addresses) - we'll find coordinates (now supports intra-city locations like "Mayur Vihar Phase 1, Delhi")</li>
                <li><strong>Option 2:</strong> from_lat, from_lon, to_lat, to_lon (coordinates)</li>
                <li><strong>Option 3:</strong> Mix both - city names OR coordinates</li>
                <li><strong>Option 4:</strong> Malformed rows like "Delhi,Mumbai" or """City1,Sub,City2,Sub""" (we auto-split and handle commas in names)</li>
              </ul>
              
              <p><em>💡 Intra-city now works with Nominatim geocoding. Add spaces in names for better accuracy (e.g., "Mayur Vihar Phase 1, Delhi"). Max ~200 rows recommended for free processing.</em></p>
            </div>

            <div className="file-upload-area">
              <input
                type="file"
                accept=".csv"
                onChange={handleFileUpload}
                id="file-input"
                style={{ display: 'none' }}
                disabled={processing}
              />
              <label htmlFor="file-input" className={`upload-button ${processing ? 'disabled' : ''}`}>
                📁 Choose CSV File
              </label>
            </div>

            {processing && (
              <div className="processing-indicator">
                <div className="spinner"></div>
                <p>
                  {processProgress.phase === 'parsing' && 'Parsing CSV...'}
                  {processProgress.phase === 'geocoding' && `Geocoding locations... (${processProgress.current}/${processProgress.total})`}
                  {processProgress.phase === 'calculating' && `Calculating air distances... (${processProgress.current}/${processProgress.total})`}
                  {processProgress.phase === 'routing' && `Routing roads... (${processProgress.current}/${processProgress.total})`}
                </p>
              </div>
            )}

            {bulkResults.length > 0 && (
              <div className="bulk-results">
                <div className="results-header">
                  <h3>✅ Results ({bulkResults.length} routes)</h3>
                  <button onClick={downloadResults} className="download-btn">
                    ⬇️ Download CSV
                  </button>
                </div>
                <div className="results-table">
                  <table>
                    <thead>
                      <tr>
                        <th>From</th>
                        <th>To</th>
                        <th>From Lat</th>
                        <th>From Lon</th>
                        <th>To Lat</th>
                        <th>To Lon</th>
                        <th>Distance (km)</th>
                        <th>Distance (mi)</th>
                        {bulkTravelMode === 'air' ? (
                          <th>Flight Time (hrs)</th>
                        ) : (
                          <>
                            <th>Drive Time (hrs)</th>
                            <th>Drive Time (min)</th>
                          </>
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {bulkResults.map((result, idx) => (
                        <tr key={idx} style={result.error ? { backgroundColor: '#fee' } : {}}>
                          <td>{result.from}</td>
                          <td>{result.to}</td>
                          <td>{result.from_lat}</td>
                          <td>{result.from_lon}</td>
                          <td>{result.to_lat}</td>
                          <td>{result.to_lon}</td>
                          <td>{result.distance_km}</td>
                          <td>{result.distance_miles}</td>
                          {bulkTravelMode === 'air' ? (
                            <td>{result.flight_time_hours || '-'}</td>
                          ) : (
                            <>
                              <td>{result.drive_time_hours || '-'}</td>
                              <td>{result.drive_time_minutes || '-'}</td>
                            </>
                          )}
                          {result.error && (
                            <td colSpan={bulkTravelMode === 'air' ? 1 : 2} style={{ color: '#dc2626', fontSize: '0.85rem' }}>
                              {result.error}
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        ) : (
          <>
            <div className="locations-grid">
              <div className="location-card from-card">
                <div className="location-header">
                  <span className="icon">📍</span>
                  <h3>From</h3>
                </div>
                
                {mode === 'search' ? (
                  <div className="search-container">
                    <input
                      type="text"
                      placeholder="Search for a city or address..."
                      value={searchQuery.from}
                      onChange={(e) => {
                        setSearchQuery(prev => ({ ...prev, from: e.target.value }));
                        fetchCities(e.target.value, 'from');
                      }}
                      className="city-search"
                    />
                    {loading.from && <div className="searching">Searching...</div>}
                    {!loading.from && suggestions.from.length > 0 && (
                      <div className="suggestions">
                        {suggestions.from.map((city, idx) => (
                          <div
                            key={idx}
                            className="suggestion-item"
                            onClick={() => selectCity(city, 'from')}
                          >
                            {city.display}
                          </div>
                        ))}
                      </div>
                    )}
                    {!loading.from && searchQuery.from && suggestions.from.length === 0 && (
                      <div className="no-results">No cities found</div>
                    )}
                  </div>
                ) : (
                  <div className="custom-inputs">
                    <input
                      type="text"
                      placeholder="City Name"
                      value={fromCity.name}
                      onChange={(e) => handleCustomInput('from', 'name', e.target.value)}
                      className="input-field"
                    />
                    <input
                      type="number"
                      placeholder="Latitude"
                      value={fromCity.lat}
                      onChange={(e) => handleCustomInput('from', 'lat', e.target.value)}
                      className="input-field"
                      step="0.0001"
                    />
                    <input
                      type="number"
                      placeholder="Longitude"
                      value={fromCity.lon}
                      onChange={(e) => handleCustomInput('from', 'lon', e.target.value)}
                      className="input-field"
                      step="0.0001"
                    />
                  </div>
                )}
                
                <div className="coordinates">
                  <p className="city-name">{fromCity.name}</p>
                  <p>Lat: {fromCity.lat.toFixed(4)}° | Lon: {fromCity.lon.toFixed(4)}°</p>
                </div>
              </div>

              <div className="location-card to-card">
                <div className="location-header">
                  <span className="icon">🎯</span>
                  <h3>To</h3>
                </div>
                
                {mode === 'search' ? (
                  <div className="search-container">
                    <input
                      type="text"
                      placeholder="Search for a city or address..."
                      value={searchQuery.to}
                      onChange={(e) => {
                        setSearchQuery(prev => ({ ...prev, to: e.target.value }));
                        fetchCities(e.target.value, 'to');
                      }}
                      className="city-search"
                    />
                    {loading.to && <div className="searching">Searching...</div>}
                    {!loading.to && suggestions.to.length > 0 && (
                      <div className="suggestions">
                        {suggestions.to.map((city, idx) => (
                          <div
                            key={idx}
                            className="suggestion-item"
                            onClick={() => selectCity(city, 'to')}
                          >
                            {city.display}
                          </div>
                        ))}
                      </div>
                    )}
                    {!loading.to && searchQuery.to && suggestions.to.length === 0 && (
                      <div className="no-results">No cities found</div>
                    )}
                  </div>
                ) : (
                  <div className="custom-inputs">
                    <input
                      type="text"
                      placeholder="City Name"
                      value={toCity.name}
                      onChange={(e) => handleCustomInput('to', 'name', e.target.value)}
                      className="input-field"
                    />
                    <input
                      type="number"
                      placeholder="Latitude"
                      value={toCity.lat}
                      onChange={(e) => handleCustomInput('to', 'lat', e.target.value)}
                      className="input-field"
                      step="0.0001"
                    />
                    <input
                      type="number"
                      placeholder="Longitude"
                      value={toCity.lon}
                      onChange={(e) => handleCustomInput('to', 'lon', e.target.value)}
                      className="input-field"
                      step="0.0001"
                    />
                  </div>
                )}
                
                <div className="coordinates">
                  <p className="city-name">{toCity.name}</p>
                  <p>Lat: {toCity.lat.toFixed(4)}° | Lon: {toCity.lon.toFixed(4)}°</p>
                </div>
              </div>
            </div>

            <button onClick={handleCalculate} className="calculate-btn">
              {travelMode === 'air' ? '✈️ Calculate Air Distance' : '🚗 Calculate Road Distance'}
            </button>

            {distance !== null && (
              <div className="results">
                <h3>{travelMode === 'air' ? '✈️ Air Distance Results' : '🚗 Road Distance Results'}</h3>
                <div className="result-item">
                  <span className="result-label">Route:</span>
                  <span className="result-value">{fromCity.name} → {toCity.name}</span>
                </div>
                
                {travelMode === 'air' ? (
                  <>
                    <div className="result-item">
                      <span className="result-label">Air Distance (km):</span>
                      <span className="result-value large">{distance.toFixed(2)} km</span>
                    </div>
                    <div className="result-item">
                      <span className="result-label">Air Distance (miles):</span>
                      <span className="result-value large">{(distance * 0.621371).toFixed(2)} mi</span>
                    </div>
                    <div className="result-item">
                      <span className="result-label">Approx Flight Time:</span>
                      <span className="result-value">{Math.floor((distance / 800) * 60)} minutes ({(distance / 800).toFixed(1)} hours)</span>
                    </div>
                  </>
                ) : (
                  <>
                    {calculatingRoad ? (
                      <div className="calculating-road">
                        <div className="spinner-small"></div>
                        <p>Calculating road route...</p>
                      </div>
                    ) : roadError ? (
                      <div className="road-error">
                        <p>⚠️ {roadError}</p>
                        <div className="result-item">
                          <span className="result-label">Air Distance (km):</span>
                          <span className="result-value">{distance.toFixed(2)} km</span>
                        </div>
                      </div>
                    ) : roadDistance ? (
                      <>
                        <div className="result-item">
                          <span className="result-label">Road Distance (km):</span>
                          <span className="result-value large">{roadDistance.toFixed(2)} km</span>
                        </div>
                        <div className="result-item">
                          <span className="result-label">Road Distance (miles):</span>
                          <span className="result-value large">{(roadDistance * 0.621371).toFixed(2)} mi</span>
                        </div>
                        <div className="result-item">
                          <span className="result-label">Estimated Drive Time:</span>
                          <span className="result-value">
                            {Math.floor(roadDuration)} minutes ({(roadDuration / 60).toFixed(1)} hours)
                          </span>
                        </div>
                        <div className="result-item">
                          <span className="result-label">Air Distance (km):</span>
                          <span className="result-value">{distance.toFixed(2)} km</span>
                        </div>
                        <div className="result-item">
                          <span className="result-label">Extra Distance by Road:</span>
                          <span className="result-value">
                            {(roadDistance - distance).toFixed(2)} km ({((roadDistance / distance - 1) * 100).toFixed(1)}% more)
                          </span>
                        </div>
                      </>
                    ) : null}
                  </>
                )}
              </div>
            )}

            <div className="info">
              <p>💡 {travelMode === 'air' 
                ? 'Air distance calculates the great circle distance (as the crow flies)' 
                : 'Road distance shows actual driving route via roads (supports intra-city addresses)'}</p>
              <p>{travelMode === 'air' 
                ? 'Actual flight paths may vary due to air traffic routes and weather' 
                : 'Drive time is estimated and may vary based on traffic conditions. Bulk geocoding now handles addresses accurately!'}</p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
