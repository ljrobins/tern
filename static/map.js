let map;
let userInteracting = false;

initializeMap()

// Function to generate color based on segment length (simple linear scale)
function getColorForLength(length, maxLength) {
    // Normalize the length value to a range between 0 and 1
    const minLength = 0; // Minimum length (adjust this as needed)

    // Normalize the length
    const normalizedLength = Math.min(Math.max((length - minLength) / (maxLength - minLength), 0), 1);

    // Linear gradient from blue (short segments) to red (long segments)
    const r = Math.floor(255 * normalizedLength);
    const g = 0;
    const b = Math.floor(255 * (1 - normalizedLength));

    return `rgb(${r}, ${g}, ${b})`; // Return the color in RGB format
}


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

    if (!geojson || geojson.type !== 'FeatureCollection') {
        console.error(`Source data for "${layerName}" is not a valid GeoJSON FeatureCollection.`);
        return;
    }

    // Calculate the bounding box of the GeoJSON
    const bounds = new maplibregl.LngLatBounds();

    geojson.features.forEach(feature => {
        const coords = feature.geometry.coordinates;

        if (feature.geometry.type === 'Point') {
            bounds.extend(coords);
        } else if (feature.geometry.type === 'LineString' || feature.geometry.type === 'Polygon') {
            coords.forEach(coord => bounds.extend(coord));
        } else if (feature.geometry.type === 'MultiPolygon' || feature.geometry.type === 'MultiLineString') {
            coords.forEach(coord => bounds.extend(coord));
        }
    });

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

    if (userHeading < 0) { // if we have not recorded a heading yet, it doesn't matter
        headingTolerance = 360
    } else {
        headingTolerance = 60 // the default value used by Valhalla
    }
    console.log(`/api/route?lat_start=${startLat}&lon_start=${startLon}&lat_end=${endLat}&lon_end=${endLon}&heading=${userHeading}&heading_tolerance=${headingTolerance}`)

    // Call the Flask API to get the route using fetch
    fetch(`/api/route?lat_start=${startLat}&lon_start=${startLon}&lat_end=${endLat}&lon_end=${endLon}&heading=${userHeading}&heading_tolerance=${headingTolerance}`)
        .then(response => response.json())
        .then(data => {
            console.log("Route Response:", data);

            // Check for errors in the response
            if (data.error) {
                alert("Error: " + data.error);
                return;
            }

            // Process and display the route
            route = data.trip; // sets it globally
            processAudioForRouteIncrementally(route)

            // Step 1: Calculate the maximum length within the route

            route.legs[0].maneuvers.forEach(maneuver => {
                console.log(maneuver)
            });

            let maxLength = 0;
            route.legs[0].maneuvers.forEach(maneuver => {
                maxLength = Math.max(maxLength, maneuver.length / (maneuver.time + 1));
            });

            // Group all segments into a single GeoJSON source
            const routeFeatures = [];

            route.legs[0].maneuvers.forEach((maneuver, i) => {
                const segmentCoordinates = [];

                // Iterate through the shape indices for this maneuver
                for (let j = maneuver.begin_shape_index; j <= maneuver.end_shape_index; j++) {
                    segmentCoordinates.push(route.shape[j]);
                }

                // Generate the color for this segment based on its length
                const segmentLength = maneuver.length / (maneuver.time + 1);
                const segmentColor = getColorForLength(segmentLength, maxLength);

                // Add this segment as a feature in the route features array
                const geoJSONSegment = {
                    type: 'Feature',
                    geometry: {
                        type: 'LineString',
                        coordinates: segmentCoordinates
                    },
                    properties: {
                        color: segmentColor // Store the color for each segment
                    }
                };

                routeFeatures.push(geoJSONSegment);
            });

            // Combine all the features into one GeoJSON object
            const geoJSON = {
                type: 'FeatureCollection',
                features: routeFeatures
            };

            // Check if the route already exists
            if (map.getSource('route')) {
                // If route already exists, update the source with the new coordinates
                map.getSource('route').setData(geoJSON);
            } else {
                // Add the route source (single source for all segments)
                map.addSource('route', {
                    type: 'geojson',
                    data: geoJSON
                });

                // Add a single route layer with a data-driven style for the color
                map.addLayer({
                    id: 'route',
                    type: 'line',
                    source: 'route',
                    paint: {
                        'line-width': 4,
                        // Use the 'color' property for the line color
                        'line-color': ['get', 'color'] // Get the color for each segment from the properties
                    }
                });
            }
            zoomToFitLayer('route')
        }
        )
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
    let lastUpdateTime = 0; // Timestamp for throttling updates
    const throttleInterval = 20; // Minimum interval between updates (milliseconds)
    let lastBearing = null; // Store the last bearing to check for significant changes

    // Event handler for device orientation
    function handleDeviceOrientation(event) {
        const now = Date.now();
        if (compassActive) {
            // disable map rotation using right click + drag
            map.dragRotate.disable();
            // disable map rotation using keyboard
            map.keyboard.disable();
            // disable map rotation using touch rotation gesture
            map.touchZoomRotate.disableRotation();
        }
        if (compassActive && !userInteracting) {
            if (now - lastUpdateTime < throttleInterval) return; // Skip if within throttle interval

            let compassHeading; // Compass heading in degrees (0 to 360)

            if (event.webkitCompassHeading) {
                // You may consider adding/distracting landscape/portrait mode value here
                compassHeading = event.webkitCompassHeading;
                if (compassHeading < 0) { compassHeading += 360; }
                if (compassHeading > 360) { compassHeading -= 360; }
            } else {
                compassHeading = event.alpha;
            }

            // Only update if the bearing is significantly different
            if (lastBearing === null || Math.abs(compassHeading - lastBearing) > 1) { // 5 degrees threshold for change
                map.setBearing(compassHeading); // Set the new bearing
                lastBearing = compassHeading; // Update last bearing
            }
        }

        lastUpdateTime = now; // Update timestamp
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
    map.setRenderWorldCopies(false);
    console.log("Map initialized.");

    // Add navigation controls to the map
    map.addControl(new maplibregl.NavigationControl(), "top-right");

    // Listen for user interactions with the map
    map.on('mousedown', () => userInteracting = true);
    map.on('touchstart', () => userInteracting = true);
    map.on('mouseup', () => userInteracting = false);
    map.on('touchend', () => userInteracting = false);

    // Adds the geolocate control
    // map.addControl(
    //     new maplibregl.GeolocateControl({
    //         positionOptions: {
    //             enableHighAccuracy: true
    //         },
    //         trackUserLocation: true,
    //         showUserLocation: false,
    //     })
    // );

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