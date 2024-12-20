from flask import Flask, render_template, request, jsonify
from flask_socketio import SocketIO, emit
import urllib.parse
import urllib.request
import json
import polyline

app = Flask(__name__)
socketio = SocketIO(app)

# Function to send request to the external API
def send_request(base_url, **params):
    if 'json' in params:
        params["json"] = json.dumps(params["json"])
    query_string = urllib.parse.urlencode(params, quote_via=urllib.parse.quote)
    full_url = f"{base_url}?{query_string}"
    print(f"Requesting URL: {full_url}")
    with urllib.request.urlopen(full_url) as response:
        response_data = response.read().decode('utf-8')
        json_data = json.loads(response_data)
        return json_data, response.status

# Route to render the map page
@app.route('/')
def map():
    return render_template('map.html')

# WebSocket route to handle continuous geolocation updates
@socketio.on('location_update')
def handle_geolocation_update(data):
    latitude = data.get("lat")
    longitude = data.get("lon")
    accuracy = data.get("acc")
    if latitude and longitude:
        print(f"Updated Location: Lat: {latitude}, Lon: {longitude}")
        # Emit an acknowledgment (optional)
        emit("location_ack", {"message": "Location received", "latitude": latitude, "longitude": longitude, "accuracy": accuracy})
    else:
        emit("location_ack", {"error": "Invalid location data"})

# API endpoint to handle search input and return points
@app.route('/api/search', methods=['GET'])
def search():
    user_query = request.args.get('query')  # Get user input
    if not user_query:
        return jsonify({"error": "No query provided"}), 400

    base_url = "http://192.168.4.23:8010/search"  # External API
    try:
        # Call the search API
        response_data, status = send_request(base_url, q=user_query, format="json", limit=100)

        # Convert the response into Point geometries (GeoJSON FeatureCollection)
        features = []
        for result in response_data:
            if "lat" in result and "lon" in result:  # Ensure lat/lon exist
                features.append({
                    "type": "Feature",
                    "geometry": {
                        "type": "Point",
                        "coordinates": [float(result["lon"]), float(result["lat"])]
                    },
                    "properties": {
                        "name": result.get("display_name", "Unnamed Location")
                    }
                })

        return jsonify({
            "type": "FeatureCollection",
            "features": features
        })

    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/route', methods=['GET'])
def get_route():
    # Get the query parameters for the start and end points
    lat_start = float(request.args.get('lat_start'))
    lon_start = float(request.args.get('lon_start'))
    lat_end = float(request.args.get('lat_end'))
    lon_end = float(request.args.get('lon_end'))

    # Base URL without query parameters
    base_url = "http://192.168.4.23:8002/route"

    # Query parameters passed as kwargs
    params = {
        "json": {
            "costing": "auto",
            "costing_options": {
                "auto": {
                    "exclude_polygons": [],
                    "maneuver_penalty": 5,
                    "country_crossing_penalty": 0,
                    "country_crossing_cost": 600,
                    "width": 1.6,
                    "height": 1.9,
                    "use_highways": 1,
                    "use_tolls": 1,
                    "use_ferry": 1,
                    "ferry_cost": 300,
                    "use_living_streets": 0.5,
                    "use_tracks": 0,
                    "private_access_penalty": 450,
                    "ignore_closures": False,
                    "closure_factor": 9,
                    "service_penalty": 15,
                    "service_factor": 1,
                    "exclude_unpaved": 1,
                    "shortest": False,
                    "exclude_cash_only_tolls": False,
                    "top_speed": 140
                }
            },
            "exclude_polygons": [],
            "locations": [
                {"lon": lon_start, "lat": lat_start, "type": "break"},
                {"lon": lon_end, "lat": lat_end, "type": "break"}
            ],
            "directions_options": {"units": "kilometers"},
            "id": "valhalla_directions"
        }
    }

    resp, status = send_request(base_url, **params)
    print(json.dumps(resp, indent=4))
    
    resp['trip']['shape'] = polyline.decode(resp['trip']['legs'][-1]['shape'], geojson=True)
    resp['trip']['shape'] = [[y/10 for y in x]for x in resp['trip']['shape']]
    del resp['trip']['legs'][-1]['shape']

    # resp['decoded_shape'] = polyline.decode(resp['trip']['legs'][-1]['shape'])

    # Check if the request was successful
    if status == 200:
        return jsonify(resp)
    else:
        return jsonify({'error': 'Failed to get route'}), status_code

if __name__ == '__main__':
    context = ('cert/server.crt', 'cert/server.key')#certificate and key files
    socketio.run(app, host='0.0.0.0', debug=True, ssl_context=context)
