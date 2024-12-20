let map;

initializeMap()

// Function to zoom to fit an existing layer by name
function zoomToFitLayer(layerName) {
    // Get the source associated with the layer
    const source = map.getSource(layerName);

    if (!source) {
        console.error(`Layer with name "${layerName}" does not exist.`);
        return;
    }

    // Retrieve the GeoJSON data from the source
    const geojson = source._data; // Access the source data (private API)
    console.log(geojson)

    // Calculate the bounding box of the GeoJSON
    const bounds = new maplibregl.LngLatBounds();

    const coords = geojson.geometry.coordinates;

    // Assuming `geojson.geometry` exists and is valid
    if (geojson.geometry.type === 'LineString') {
        // Directly iterate over the coordinates for LineString
        geojson.geometry.coordinates.forEach(coord => bounds.extend(coord));
    } else if (geojson.geometry.type === 'Polygon') {
        // For Polygons, iterate over the array of rings
        geojson.geometry.coordinates.forEach(ring => {
            ring.forEach(coord => bounds.extend(coord));
        });
    } else {
        console.warn(`Geometry type "${geojson.geometry.type}" is not supported.`);
    }

    if (bounds.isEmpty()) {
        console.warn(`No valid features found in the layer "${layerName}".`);
        return;
    }

    // Fit the map view to the calculated bounds
    map.fitBounds(bounds, {
        padding: 50, // Optional padding (in pixels)
        maxZoom: 15, // Optional maximum zoom level
        duration: 1000 // Animation duration (in milliseconds)
    });
}

// Function to get the route from Flask API
function getRoute(start, end) {
    // Start point and end point
    const startLat = start[0];
    const startLon = start[1];
    const endLat = end[0];
    const endLon = end[1];

    // Call the Flask API to get the route using fetch
    fetch(`/api/route?lat_start=${startLat}&lon_start=${startLon}&lat_end=${endLat}&lon_end=${endLon}`)
        .then(response => response.json())
        .then(data => {
            console.log("Route Response:", data);

            // Check for errors in the response
            if (data.error) {
                alert("Error: " + data.error);
                return;
            }

            // Process and display the route
            const route = data.trip;
            const routeCoordinates = route.shape;

            if (routeCoordinates.length > 0) {
                // Check if the route already exists
                if (map.getSource('route')) {
                    // If route already exists, update the source with the new coordinates
                    map.getSource('route').setData({
                        type: 'Feature',
                        geometry: {
                            type: 'LineString',
                            coordinates: routeCoordinates
                        }
                    });
                } else {
                    // If the route does not exist, add the source and layer
                    const geoJSON = {
                        type: 'Feature',
                        geometry: {
                            type: 'LineString',
                            coordinates: routeCoordinates
                        }
                    };

                    // Add the route source
                    map.addSource('route', {
                        type: 'geojson',
                        data: geoJSON
                    });

                    // Add the route layer with corrected 'paint' properties
                    map.addLayer({
                        id: 'route',
                        type: 'line',
                        source: 'route',
                        paint: {
                            'line-width': 4,  // This goes under 'paint', not 'layout'
                            'line-color': '#ff0000'  // This goes under 'paint', not 'layout'
                        }
                    });
                }
                zoomToFitLayer('route')
            } else {
                console.error("Route coordinates are empty or invalid.");
            }

        })
        .catch(error => {
            console.error('Error fetching route:', error);
            alert("An error occurred while fetching the route.");
        });
}


function addSearchComponent() {
    map.addSource('search-results', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] }
    });

    // Add a circle layer for points
    map.addLayer({
        id: 'search-results-layer',
        type: 'circle',
        source: 'search-results',
        paint: {
            'circle-radius': 6,
            'circle-color': '#FF0000',
            'circle-stroke-width': 2,
            'circle-stroke-color': '#FFFFFF'
        }
    });
}

// Function to sync map rotation with the compass
function syncMapWithCompass() {
    let compassActive = false;
    let userInteracting = false;
    let lastUpdateTime = 0; // Timestamp for throttling updates
    const throttleInterval = 100; // Minimum interval between updates (milliseconds)
    let lastBearing = null; // Store the last bearing to check for significant changes

    let currentLatitude = null;
    let currentLongitude = null;

    // Helper function to calculate bearing from two geo coordinates
    function calculateBearing(lat1, lon1, lat2, lon2) {
        const rad = Math.PI / 180;
        const dLon = (lon2 - lon1) * rad;
        const lat1Rad = lat1 * rad;
        const lat2Rad = lat2 * rad;

        const y = Math.sin(dLon) * Math.cos(lat2Rad);
        const x = Math.cos(lat1Rad) * Math.sin(lat2Rad) - Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(dLon);

        let bearing = Math.atan2(y, x) / rad;
        bearing = (bearing + 360) % 360; // Normalize the bearing to 0-360
        return bearing;
    }

    // Update the current device GPS coordinates
    function updateDeviceLocation(position) {
        currentLatitude = position.coords.latitude;
        currentLongitude = position.coords.longitude;
    }

    // Event handler for device orientation
    function handleDeviceOrientation(event) {
        if (compassActive && !userInteracting) {
            const now = Date.now();
            if (now - lastUpdateTime < throttleInterval) return; // Skip if within throttle interval

            if (currentLatitude !== null && currentLongitude !== null) {
                // Get the magnetic heading (alpha) if available
                const compassHeading = event.alpha; // Compass heading in degrees (0 to 360)

                if (compassHeading != null) {
                    // Calculate the absolute bearing using GPS and update the map's bearing
                    const bearing = calculateBearing(currentLatitude, currentLongitude, currentLatitude + 0.0001, currentLongitude); // Small offset to calculate bearing
                    const adjustedBearing = compassHeading - bearing; // Adjust the bearing for true North
                    
                    // Only update if the bearing is significantly different
                    if (lastBearing === null || Math.abs(adjustedBearing - lastBearing) > 5) { // 5 degrees threshold for change
                        map.setBearing(adjustedBearing); // Set the new bearing
                        lastBearing = adjustedBearing; // Update last bearing
                    }
                }
            }

            lastUpdateTime = now; // Update timestamp
        }
    }

    // Enable compass sync on map click
    map.on('click', () => {
        if (typeof DeviceOrientationEvent.requestPermission === 'function') {
            // iOS and some modern browsers
            DeviceOrientationEvent.requestPermission()
                .then(permissionState => {
                    if (permissionState === 'granted') {
                        if (!compassActive) {
                            window.addEventListener('deviceorientation', handleDeviceOrientation);
                            compassActive = true;
                            alert('Compass sync enabled!');
                        }
                    } else {
                        alert('Permission denied for device orientation.');
                    }
                })
                .catch(error => console.error('Error requesting compass permission:', error));
        } else {
            // For browsers that don't require explicit permission
            if (!compassActive) {
                window.addEventListener('deviceorientation', handleDeviceOrientation);
                compassActive = true;
                alert('Compass sync enabled!');
            }
        }
    });

    // Listen for user interactions with the map
    map.on('mousedown', () => userInteracting = true);
    map.on('touchstart', () => userInteracting = true);
    map.on('mouseup', () => userInteracting = false);
    map.on('touchend', () => userInteracting = false);

    // Allow compass sync to resume after user interaction stops
    map.on('moveend', () => {
        if (compassActive && !userInteracting) {
            lastUpdateTime = 0; // Reset throttling on user action
        }
    });

    // Listen to geolocation updates
    navigator.geolocation.watchPosition(updateDeviceLocation, error => {
        console.error('Error fetching geolocation:', error);
    });
}


function initializeMap() {
    map = new maplibregl.Map({
        container: 'map',
        style: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
        center: [-119.4179, 36.7783], // Centered on California
        zoom: 5,
    });
    console.log("Map initialized.");

    // Add navigation controls to the map
    map.addControl(new maplibregl.NavigationControl(), "top-right");

    // Add a GeoJSON source for search results
    map.on('load', () => {
        initializeDestinationSelector();
        addSearchComponent();
        initializeLocationWatch();
        syncMapWithCompass();
    });
}


// Handle search input and send it to the backend
function handleSearch(event) {
    if (event.key === "Enter") { // Trigger search on Enter key
        const query = document.getElementById("search-box").value;

        if (query) {
            fetch(`/api/search?query=${encodeURIComponent(query)}`)
                .then(response => response.json())
                .then(data => {
                    console.log("Search Response:", data);

                    if (data.error) {
                        alert("Error: " + data.error);
                        return;
                    }

                    // Update the map with the search results (points)
                    console.log(map);
                    map.getSource('search-results').setData(data);

                    // Fit the map view to the search results
                    if (data.features.length > 0) {
                        const bounds = new maplibregl.LngLatBounds();
                        data.features.forEach(feature => {
                            bounds.extend(feature.geometry.coordinates);
                        });
                        map.fitBounds(bounds, { padding: 20 });
                    } else {
                        alert("No results found.");
                    }
                })
                .catch(error => console.error("Error fetching search data:", error));
        }
    }
}

function fitMapToUserLocation(latitude, longitude, bufferDistanceMeters) {
    const earthRadius = 6371000; // Earth radius in meters

    // Calculate latitude and longitude offsets
    const latOffset = (bufferDistanceMeters / earthRadius) * (180 / Math.PI);
    const lngOffset = (bufferDistanceMeters / earthRadius) * (180 / Math.PI) / Math.cos(latitude * Math.PI / 180);

    // Create bounds using the offsets
    const bounds = [
        [longitude - lngOffset, latitude - latOffset], // Southwest corner
        [longitude + lngOffset, latitude + latOffset], // Northeast corner
    ];

    // Fit the map to the bounds
    map.fitBounds(bounds, { padding: 20 });
}