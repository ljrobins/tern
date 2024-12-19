let map;

initializeMap()

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