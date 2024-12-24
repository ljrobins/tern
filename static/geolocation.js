// Connect to the WebSocket server
const socket = io();

let firstUnixTimestamp = null;
let locationFit = new QuadraticFit();

// Marker and Circle Layer Initialization
let userMarker = null;
let uncertaintyCircleId = "uncertainty-circle";
let gpsStdMeters = null;

let destinationMarker = null; // Global variable to store the destination marker
let closestPointMarker = null; // Global variable to store the closest point on the route

let longTapTimeout;
let userIsRouted = false;
let isRerouting = false;
let route = null;
let userHeading = -1; // nonphysical
let previousUserMarkerLngLat = null;
let directionLine = null;
let closestDistanceEver = Number.MAX_VALUE;
const METERS_TO_MILES = 0.0006213712;
let headingUpdateDistanceMiles = 5 * METERS_TO_MILES // User must move 5 meters to get a good heading update

// Minimum duration (in milliseconds) to register as a long-tap
const longTapDuration = 500;

setInterval(trackUser, 1000); // start tracking the user

function computeHeading(lat1, lon1, lat2, lon2) {
    // Convert latitude and longitude from degrees to radians
    const radLat1 = (lat1 * Math.PI) / 180;
    const radLon1 = (lon1 * Math.PI) / 180;
    const radLat2 = (lat2 * Math.PI) / 180;
    const radLon2 = (lon2 * Math.PI) / 180;

    // Calculate the difference in longitudes
    const dLon = radLon2 - radLon1;

    // Compute the initial bearing using the formula
    const y = Math.sin(dLon) * Math.cos(radLat2);
    const x =
        Math.cos(radLat1) * Math.sin(radLat2) -
        Math.sin(radLat1) * Math.cos(radLat2) * Math.cos(dLon);

    // Convert the result from radians to degrees and normalize it to [0, 360)
    let heading = (Math.atan2(y, x) * 180) / Math.PI;
    heading = (heading + 360) % 360;

    return heading; // Heading in degrees
}

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

function maneuverIndexOfShapeIndices(indices) {
    let maneuverIndex = -1;
    route.legs[0].maneuvers.forEach((maneuver, i) => {
        if ((indices[0] >= maneuver.begin_shape_index) && (indices[1] >= maneuver.begin_shape_index)) {
            if ((indices[0] <= maneuver.end_shape_index) && (indices[1] <= maneuver.end_shape_index)) {
                maneuverIndex = i;
            }
        }
    })
    return maneuverIndex;
}

// Function to calculate the fraction of the current maneuver that has been completed
function maneuverFractionComplete(currentManeuverIndex, closestPointOnSegment) {
    const routeCoordinates = route.shape;
    const maneuver = route.legs[0].maneuvers[currentManeuverIndex];
    const { begin_shape_index, end_shape_index, length: maneuverLength } = maneuver;
    const { indices, fractionComplete } = closestPointOnSegment;

    // Total distance covered in the maneuver so far
    let totalDistance = 0;

    // Iterate over route coordinates within the maneuver's shape indices
    for (let i = begin_shape_index; i < end_shape_index; i++) {
        // Stop if we reach the closest segment
        if (i === indices[0]) {
            // Add the fractionComplete of the current segment
            const [lngStart, latStart] = routeCoordinates[indices[0]];
            const [lngEnd, latEnd] = routeCoordinates[indices[1]];
            totalDistance += haversine(latStart, lngStart, latEnd, lngEnd) * fractionComplete;
            break;
        }

        const [lng1, lat1] = routeCoordinates[i];
        const [lng2, lat2] = routeCoordinates[i + 1];

        // Add the segment distance
        totalDistance += haversine(lat1, lng1, lat2, lng2);
    }

    // Calculate the fraction of the maneuver completed
    const fractionCompleteForManeuver = totalDistance / maneuverLength; // converting maneuverLength from km to mi in the process

    return fractionCompleteForManeuver; // Clamp to 1 for edge cases
}

function readDirections(currentManeuver, nextManeuver, mfComplete, currentManeuverIndex) {
    if (currentManeuverIndex == 0) {
        if (!!currentManeuver.verbal_pre_transition_instruction.audio) {
            if ((mfComplete < 0.1) && (currentManeuver.verbal_pre_transition_instruction.audio.played.length == 0) && !currentManeuver.verbal_pre_transition_instruction.audio.queued) {
                // note the addition of a not queued check to handle the case when multiple reroutes happen in short succession
                directionLine = `${currentManeuver.instruction.text}`;
                enqueueAudioRequest(currentManeuver.verbal_pre_transition_instruction.audio);
            }
        }

        if (!!currentManeuver.verbal_post_transition_instruction.audio) {
            if ((mfComplete > 0.1) && (currentManeuver.verbal_post_transition_instruction.audio.played.length == 0)) {
                directionLine = `${currentManeuver.verbal_post_transition_instruction.text}`;
                enqueueAudioRequest(currentManeuver.verbal_post_transition_instruction.audio);
            }
        }
    } else {
        if (!!currentManeuver.verbal_post_transition_instruction.audio) {
            if ((mfComplete < 0.1) && (currentManeuver.verbal_post_transition_instruction.audio.played.length == 0)) {
                directionLine = `${currentManeuver.verbal_post_transition_instruction.text}`;
                enqueueAudioRequest(currentManeuver.verbal_post_transition_instruction.audio);
            }
        }    
    }

    if (!!nextManeuver) { // whenever the next maneuver exists
        if (!!nextManeuver.verbal_pre_transition_instruction.audio) {
            if ((mfComplete > 0.8) && (nextManeuver.verbal_pre_transition_instruction.audio.played.length == 0)) {
                enqueueAudioRequest(nextManeuver.verbal_pre_transition_instruction.audio);
                directionLine = `${nextManeuver.verbal_pre_transition_instruction.text}`;
            }
        }
    }

// Compute distance and time for the current maneuver
distanceDoneMiles = mfComplete * currentManeuver.length;
distanceLeftMiles = (1 - mfComplete) * currentManeuver.length;

timeDoneMinutes = mfComplete * currentManeuver.time / 60; // Completed time for the current maneuver
timeLeftMinutes = (1 - mfComplete) * currentManeuver.time / 60; // Remaining time for the current maneuver

// Compute total time completed for all previous maneuvers and current maneuver up to mfComplete
let totalTimeDoneMinutes = 0;
let totalDistanceDoneMiles = 0;
for (let i = 0; i < currentManeuverIndex; i++) {
    totalDistanceDoneMiles += route.legs[0].maneuvers[i].length; // Add distance of all completed maneuvers
    totalTimeDoneMinutes += route.legs[0].maneuvers[i].time / 60; // Add distance of all completed maneuvers
}
totalDistanceDoneMiles += distanceDoneMiles; // Add the completed distance for the current maneuver
totalTimeDoneMinutes += timeDoneMinutes; // Add the completed time for the current maneuver

percentDoneDistance = totalDistanceDoneMiles / route.summary.length * 100 // Percent done with the whole trip in distance
percentDoneTime = totalTimeDoneMinutes / (route.summary.time/60) * 100 // Percent done with the whole trip in time

if (!!directionLine) {
    const orangeText = 
        `M: ${(Math.round(distanceDoneMiles * 10) / 10).toFixed(1)}/${(Math.round(currentManeuver.length * 10) / 10).toFixed(1)} miles (${Math.round(mfComplete * 100)}%) ` +
        `${(Math.round(timeLeftMinutes * 10) / 10).toFixed(1)} mins, `;
    
    const greyText = 
        `R: ${(Math.round(totalTimeDoneMinutes * 10) / 10).toFixed(1)}/${(Math.round(route.summary.time / 60 * 10) / 10).toFixed(1)} mins (${Math.round(percentDoneTime)}%)`;

    document.getElementById('direction-string').innerText = directionLine;
    document.getElementById('maneuver-stats').innerHTML = 
        `<span class="custom-orange">${orangeText}</span><span class="custom-grey">${greyText}</span>`;
}

}


function trackUser() {
    if (!!route) {
        // Figure out which segment the user is in
        const routeCoordinates = route.shape;

        // Find the closest point index
        const closestPointIndex = findClosestPoint(routeCoordinates, userMarker.getLngLat().lat, userMarker.getLngLat().lng);

        // Find the closest point on either the previous or next segment
        const closestPointOnSegment = findClosestPointOnSegment(routeCoordinates, closestPointIndex, userMarker.getLngLat().lat, userMarker.getLngLat().lng);

        closestDistanceEver = Math.min(closestPointOnSegment.distance, closestDistanceEver)

        const currentManeuverIndex = maneuverIndexOfShapeIndices(closestPointOnSegment.indices)
        const currentManeuver = route.legs[0].maneuvers[currentManeuverIndex];
        let nextManeuver = null;
        const totalManeuvers = route.legs[0].maneuvers.length;
        if (currentManeuverIndex < totalManeuvers - 1) {
            nextManeuver = route.legs[0].maneuvers[currentManeuverIndex + 1];
        }

        const mfComplete = maneuverFractionComplete(currentManeuverIndex, closestPointOnSegment);

        if (closestPointMarker === null) {
            closestPointMarker = new maplibregl.Marker({ color: "cyan" })
                .setLngLat([closestPointOnSegment.lng, closestPointOnSegment.lat])
                .addTo(map);
        }
        else {
            closestPointMarker.setLngLat([closestPointOnSegment.lng, closestPointOnSegment.lat])
        }

        console.log(`Closest point in maneuver ${currentManeuverIndex} between points ${closestPointOnSegment.indices} (closer to ${closestPointIndex}): ${closestPointOnSegment.lat}, ${closestPointOnSegment.lng} at a distance ${closestPointOnSegment.distance} km, we are ${closestPointOnSegment.fractionComplete} done with this line segment, ${mfComplete} done with this maneuver`);

        readDirections(currentManeuver, nextManeuver, mfComplete, currentManeuverIndex);

        positionStdMiles = gpsStdMeters * METERS_TO_MILES; // converting meters to miles

        if ((closestPointOnSegment.distance > 10 * positionStdMiles) && (closestDistanceEver < 1 * positionStdMiles) && (!isRerouting)) {
            console.log('time to reroute the user');
            getRoute([userMarker.getLngLat().lat, userMarker.getLngLat().lng], [destinationMarker.getLngLat().lat, destinationMarker.getLngLat().lng]);
            sayPhrase('Re-routing');
            isRerouting = true;
        }
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
    return R * c / 1.609344; // Return the distance in miles
}

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

    return { closestX, closestY, clampedT };
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
        closestSegment = { indices: [closestIndex, closestIndex + 1], lat: result.closestY, lng: result.closestX, distance: distance, fractionComplete: result.clampedT };
    } else {
        // Case for closestIndex > 0, check the previous and next segments
        // Check the segment before the closest point (if exists)
        const prevCoord = routeCoordinates[closestIndex - 1];
        const currCoord = routeCoordinates[closestIndex];
        const result = pointToSegmentDistance(currentLng, currentLat, prevCoord[0], prevCoord[1], currCoord[0], currCoord[1]);
        const distance = haversine(currentLat, currentLng, result.closestY, result.closestX);
        closestSegment = { indices: [closestIndex - 1, closestIndex], lat: result.closestY, lng: result.closestX, distance: distance, fractionComplete: result.clampedT };

        // Check the segment after the closest point (if exists)
        if (closestIndex < routeCoordinates.length - 1) {
            const nextCoord = routeCoordinates[closestIndex + 1];
            const result = pointToSegmentDistance(currentLng, currentLat, currCoord[0], currCoord[1], nextCoord[0], nextCoord[1]);
            const distance = haversine(currentLat, currentLng, result.closestY, result.closestX);
            if (distance < closestSegment.distance) {
                closestSegment = { indices: [closestIndex, closestIndex + 1], lat: result.closestY, lng: result.closestX, distance: distance, fractionComplete: result.clampedT };
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
                // console.log("Location update:", data);

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

    gpsStdMeters = accuracy / 2; // set the position error standard deviation to be used for rerouting

    // Update or create the marker
    if (!userMarker) {
        userMarker = new maplibregl.Marker({ color: "blue", draggable: true })
            .setLngLat(coordinates)
            .addTo(map);

        function onDragStart() {
            previousUserMarkerLngLat = userMarker.getLngLat()
        }
        function onDragEnd() {
            userHeading = computeHeading(previousUserMarkerLngLat.lat, previousUserMarkerLngLat.lng, userMarker.getLngLat().lat, userMarker.getLngLat().lng);
            console.log('Updated heading:', userHeading);
        }

        userMarker.on('dragstart', onDragStart);
        userMarker.on('dragend', onDragEnd);

    } else {
        // userMarker.setLngLat(coordinates);
        // Update the user's heading
        distanceTraveled = haversine(userMarker.getLngLat().lat, userMarker.getLngLat().lng, latitude, longitude)
        if (distanceTraveled > headingUpdateDistanceMiles) {
            userHeading = computeHeading(userMarker.getLngLat().lat, userMarker.getLngLat().lng, latitude, longitude);
            console.log('Updated heading:', userHeading);
        }
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