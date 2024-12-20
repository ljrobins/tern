// Connect to the WebSocket server
const socket = io();

// Marker and Circle Layer Initialization
let userMarker = null;
let uncertaintyCircleId = "uncertainty-circle";

let destinationMarker = null; // Global variable to store the destination marker

let longTapTimeout;

// Minimum duration (in milliseconds) to register as a long-tap
const longTapDuration = 500;

function onTouchStart(event) {
    if (event.touches.length === 1) {
        // Start the long-tap timer
        longTapTimeout = setTimeout(() => {
            // Get the coordinates of the long-tap
            const touch = event.touches[0];
            const boundingRect = map.getCanvas().getBoundingClientRect();
            const x = touch.clientX - boundingRect.left;
            const y = touch.clientY - boundingRect.top;

            // Convert screen coordinates to map coordinates
            const ll = map.unproject([x, y]);

            // Trigger your custom long-tap action
            computeAndDisplayRoute(ll);
        }, longTapDuration);
    }
}

function onTouchEnd(event) {
    // Clear the timer if the touch ends before the threshold
    clearTimeout(longTapTimeout);
}

function onTouchMove(event) {
    // Cancel the long-tap if the user moves their finger
    clearTimeout(longTapTimeout);
}

function computeAndDisplayRoute(ll) {
    console.log("Destination set at:", ll);

    // Remove the existing marker if any
    if (destinationMarker) {
        destinationMarker.remove();
    }

    // Create a new marker at the clicked location
    destinationMarker = new maplibregl.Marker({ color: 'red' })
        .setLngLat([ll.lng, ll.lat])
        .addTo(map);

    // Optional: Pan the map to the destination point
    // map.flyTo({ center: [lngLat.lng, lngLat.lat], zoom: 14 });

    // Optional: Add additional logic here, like sending the destination to the backend

    // Call the route API with start and destination
    getRoute([userMarker.getLngLat().lat, userMarker.getLngLat().lng], [ll.lat, ll.lng]);
}

function initializeDestinationSelector() {
    // Add event listeners to detect long-tap
    map.getCanvas().addEventListener('touchstart', onTouchStart);
    map.getCanvas().addEventListener('touchend', onTouchEnd);
    map.getCanvas().addEventListener('touchmove', onTouchMove);

    map.on('contextmenu', (e) => {
        computeAndDisplayRoute(e.lngLat)
    });
}

function initializeLocationWatch() {
    // Check if Geolocation API is supported
    if ("geolocation" in navigator) {
        console.log("Geolocation API is supported.");

        // Watch the user's position continuously
        const watchId = navigator.geolocation.watchPosition(
            (data) => {
                console.log(data);
                const lat = data.coords.latitude;
                const lon = data.coords.longitude;
                const acc = data.coords.accuracy;

                // Emit geolocation updates to the WebSocket server
                socket.emit("location_update", { lat, lon, acc });

                // Listen for location updates from the server
                console.log("Location update:", data);

                // Update map with user's position and uncertainty
                updateUserPosition(lat, lon, acc);

            },
            (error) => {
                console.error("Error fetching location:", error);
            },
            {
                enableHighAccuracy: true, // Use GPS if available
                maximumAge: 0,          // No caching of location
                timeout: 100000          // Timeout after 100 seconds
            }
        );

        // Stop watching after some time (optional)
        setTimeout(() => {
            navigator.geolocation.clearWatch(watchId);
            console.log("Stopped watching location.");
        }, 60000000); // Stop after 1000 minutes
    } else {
        alert("Geolocation is not supported by your browser.");
    }

    // Handle acknowledgment from the server (optional)
    socket.on("location_ack", (data) => {
        console.log("Server Response:", data);
    });
}


// Function to create a GeoJSON circle for uncertainty
function createCircle(center, radiusInMeters, numPoints = 64) {
    const coords = [];
    const earthRadius = 6378000; // Earth radius in meters
    const lat = center[1] * (Math.PI / 180);
    const lon = center[0] * (Math.PI / 180);

    for (let i = 0; i <= numPoints; i++) {
        const angle = (i / numPoints) * (2 * Math.PI);
        const latOffset = Math.asin(Math.sin(lat) * Math.cos(radiusInMeters / earthRadius) +
            Math.cos(lat) * Math.sin(radiusInMeters / earthRadius) * Math.cos(angle));
        const lonOffset = lon + Math.atan2(Math.sin(angle) * Math.sin(radiusInMeters / earthRadius) * Math.cos(lat),
            Math.cos(radiusInMeters / earthRadius) - Math.sin(lat) * Math.sin(latOffset));
        coords.push([lonOffset * (180 / Math.PI), latOffset * (180 / Math.PI)]);
    }

    return {
        type: "Feature",
        geometry: {
            type: "Polygon",
            coordinates: [coords],
        },
    };
}

// Function to update the user's position and uncertainty on the map
function updateUserPosition(latitude, longitude, accuracy) {
    const coordinates = [longitude, latitude];
    const uncertaintyCircleId = "uncertainty-circle";

    // Update or create the marker
    if (!userMarker) {
        userMarker = new maplibregl.Marker({ color: "blue" })
            .setLngLat(coordinates)
            .addTo(map);
    } else {
        userMarker.setLngLat(coordinates);
    }

    // Create or update the uncertainty circle
    const uncertaintyCircle = createCircle(coordinates, accuracy);

    if (map.getSource(uncertaintyCircleId)) {
        map.getSource(uncertaintyCircleId).setData(uncertaintyCircle);
    } else {
        map.addSource(uncertaintyCircleId, {
            type: "geojson",
            data: uncertaintyCircle,
        });

        map.addLayer({
            id: uncertaintyCircleId,
            type: "fill",
            source: uncertaintyCircleId,
            paint: {
                "fill-color": "rgba(195, 9, 9, 0.4)",
            },
        });
        fitMapToUserLocation(latitude, longitude, 1000);
    }
}