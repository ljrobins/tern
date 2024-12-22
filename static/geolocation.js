// Connect to the WebSocket server
const socket = io();

let firstUnixTimestamp = null;
let locationFit = new QuadraticFit();

// Marker and Circle Layer Initialization
let userMarker = null;
let uncertaintyCircleId = "uncertainty-circle";

let destinationMarker = null; // Global variable to store the destination marker
let closestPointMarker = null; // Global variable to store the closest point on the route

let longTapTimeout;
let userIsRouted = false;
let route = null;

// Minimum duration (in milliseconds) to register as a long-tap
const longTapDuration = 500;

setInterval(trackUser, 1000); // start tracking the user

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

function segmentIndexOfShapeIndex(closestPointIndex) {
    let segmentIndex = -1;
    route.legs[0].maneuvers.forEach((maneuver, i) => {
        if ((closestPointIndex >= maneuver.begin_shape_index) && (closestPointIndex < maneuver.end_shape_index)) {
            segmentIndex = i;
        }
    })
    return segmentIndex;
}

function trackUser() {
    if (!!route) {
        // Figure out which segment the user is in
        const routeCoordinates = route.shape;

        // Find the closest point index
        const closestPointIndex = findClosestPoint(routeCoordinates, userMarker.getLngLat().lat, userMarker.getLngLat().lng);

        const closestSegmentIndex = segmentIndexOfShapeIndex(closestPointIndex)

        // Find the closest point on either the previous or next segment
        const closestPointOnSegment = findClosestPointOnSegment(routeCoordinates, closestPointIndex, userMarker.getLngLat().lat, userMarker.getLngLat().lng);

        if (closestPointMarker === null) {
            closestPointMarker = new maplibregl.Marker({ color: "cyan" })
                .setLngLat([closestPointOnSegment.lng, closestPointOnSegment.lat])
                .addTo(map);
        }
        else {
            console.log('setting ll of closestPointMarker')
            closestPointMarker.setLngLat([closestPointOnSegment.lng, closestPointOnSegment.lat])
        }

        console.log(`Closest point on seg ${closestSegmentIndex} between points ${closestPointOnSegment.indices} (closer to ${closestPointIndex}): ${closestPointOnSegment.lat}, ${closestPointOnSegment.lng} at a distance ${closestPointOnSegment.distance} km`);
    }
    // if (locationFit.is_fit) { // if not null
    // let t = (Date.now() - firstUnixTimestamp) / 1000; // In seconds
    // console.log('evaluating fit at', locationFit.coefficientsX, locationFit.coefficientsY, locationFit.points, t);
    // const { x, y } = locationFit.evaluate(t); // Evaluate the quadratic fit at current time
    // console.log(`Evaluated position at ${t}: x=${x}, y=${y}`);
    // map.easeTo({
    //     center: [x, y],
    //     duration: 90,
    //     easing(t) {
    //       return t;
    //     }
    //   });          
    // }
}

function computeAndDisplayRoute(ll) {
    userIsRouted = true;
    console.log("Destination set at:", ll);

    // Remove the existing marker if any
    if (destinationMarker) {
        destinationMarker.remove();
    }

    // Create a new marker at the clicked location
    destinationMarker = new maplibregl.Marker({ color: 'red', draggable: true })
        .setLngLat([ll.lng, ll.lat])
        .addTo(map);

    // Optional: Pan the map to the destination point
    // map.flyTo({ center: [lngLat.lng, lngLat.lat], zoom: 14 });

    // Optional: Add additional logic here, like sending the destination to the backend

    // Call the route API with start and destination
    getRoute([userMarker.getLngLat().lat, userMarker.getLngLat().lng], [ll.lat, ll.lng]);

    function onDragEnd() {
        getRoute([userMarker.getLngLat().lat, userMarker.getLngLat().lng], [destinationMarker.getLngLat().lat, destinationMarker.getLngLat().lng]);
    }

    destinationMarker.on('dragend', onDragEnd);
}

// Haversine formula to calculate the distance between two lat/lng points
function haversine(lat1, lon1, lat2, lon2) {
    const R = 6371; // Radius of the Earth in km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c; // Return the distance in km
}

// Function to calculate the perpendicular distance to a line segment
// Function to calculate the perpendicular distance to a line segment
function pointToSegmentDistance(px, py, x1, y1, x2, y2) {
    // Convert latitude to radians for scaling
    const latRadians = (y1 + y2) / 2 * (Math.PI / 180); // Approximate latitude for scaling
    const cosLat = Math.cos(latRadians); // Scaling factor for longitude

    // Scale x (longitude) values by cos(latitude)
    const scaledPx = px * cosLat;
    const scaledX1 = x1 * cosLat;
    const scaledX2 = x2 * cosLat;

    // Calculate squared length of the line segment
    const lineLength2 = Math.pow(y2 - y1, 2) + Math.pow(scaledX2 - scaledX1, 2);

    // Projection of the point onto the line segment
    const t = ((scaledPx - scaledX1) * (scaledX2 - scaledX1) + (py - y1) * (y2 - y1)) / lineLength2;

    // Clamp t to the range [0, 1] to ensure we are on the segment
    const clampedT = Math.max(0, Math.min(1, t));

    // Calculate the closest point on the segment
    const closestX = x1 + clampedT * (x2 - x1); // Use original x values (longitude)
    const closestY = y1 + clampedT * (y2 - y1);

    return { closestX, closestY };
}


// Function to find the closest point on the route to the current location
function findClosestPoint(routeCoordinates, currentLat, currentLng) {
    let minDistance = Infinity;
    let closestIndex = -1;

    routeCoordinates.forEach((coord, index) => {
        const [lng, lat] = coord;
        const distance = haversine(currentLat, currentLng, lat, lng);

        if (distance < minDistance) {
            minDistance = distance;
            closestIndex = index;
        }
    });

    return closestIndex;
}

// Function to find the closest point on either the previous or next segment
function findClosestPointOnSegment(routeCoordinates, closestIndex, currentLat, currentLng) {
    let closestSegment = { indices: null, lat: currentLat, lng: currentLng, distance: Infinity };

    // Case when the closest point is at the start of the route (closestIndex == 0)
    if (closestIndex === 0) {
        const currCoord = routeCoordinates[closestIndex];
        const nextCoord = routeCoordinates[closestIndex + 1];
        const result = pointToSegmentDistance(currentLng, currentLat, currCoord[0], currCoord[1], nextCoord[0], nextCoord[1]);
        const distance = haversine(currentLat, currentLng, result.closestY, result.closestX);
        closestSegment = { indices: [closestIndex, closestIndex + 1], lat: result.closestY, lng: result.closestX, distance };
    } else {
        // Case for closestIndex > 0, check the previous and next segments
        // Check the segment before the closest point (if exists)
        const prevCoord = routeCoordinates[closestIndex - 1];
        const currCoord = routeCoordinates[closestIndex];
        const resultPrev = pointToSegmentDistance(currentLng, currentLat, prevCoord[0], prevCoord[1], currCoord[0], currCoord[1]);
        const distancePrev = haversine(currentLat, currentLng, resultPrev.closestY, resultPrev.closestX);
        closestSegment = { index: [closestIndex - 1, closestIndex], lat: resultPrev.closestY, lng: resultPrev.closestX, distance: distancePrev };

        // Check the segment after the closest point (if exists)
        if (closestIndex < routeCoordinates.length - 1) {
            const nextCoord = routeCoordinates[closestIndex + 1];
            const resultNext = pointToSegmentDistance(currentLng, currentLat, currCoord[0], currCoord[1], nextCoord[0], nextCoord[1]);
            const distanceNext = haversine(currentLat, currentLng, resultNext.closestY, resultNext.closestX);
            if (distanceNext < closestSegment.distance) {
                closestSegment = { index: [closestIndex, closestIndex + 1], lat: resultNext.closestY, lng: resultNext.closestX, distance: distanceNext };
            }
        }
    }

    return closestSegment;
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
                // if (firstUnixTimestamp === null) {
                //     firstUnixTimestamp = data.timestamp; // in milliseconds
                // }
                // let t = (data.timestamp - firstUnixTimestamp) / 1000; // in seconds
                // console.log('t', data.timestamp - firstUnixTimestamp);
                // locationFit.addPoint(t, lon, lat);

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