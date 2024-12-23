from flask import (
    Flask,
    render_template,
    request,
    jsonify,
    send_file,
    send_from_directory,
)
from flask_socketio import SocketIO, emit
import urllib.parse
import urllib.request
import json
import polyline
import os
import subprocess

from celery import Celery, Task, shared_task
from time import sleep


def celery_init_app(app: Flask) -> Celery:
    class FlaskTask(Task):
        def __call__(self, *args: object, **kwargs: object) -> object:
            with app.app_context():
                return self.run(*args, **kwargs)

    celery_app = Celery(app.name, task_cls=FlaskTask)
    celery_app.config_from_object(app.config["CELERY"])
    celery_app.set_default()
    app.extensions["celery"] = celery_app
    return celery_app


@shared_task(ignore_result=False)  # -Line 4
def long_running_task(iterations) -> int:  # -Line 5
    result = 0
    for i in range(iterations):
        result += i
        sleep(2)
    return result  # -Line 6


def create_app() -> Flask:
    app = Flask(__name__)
    app.config.from_mapping(
        CELERY=dict(
            broker_url="redis://localhost",
            result_backend="redis://localhost",
            task_ignore_result=True,
        ),
    )
    app.config.from_prefixed_env()
    celery_init_app(app)
    return app


app = create_app()
socketio = SocketIO(app)

# Directory to save audio files
AUDIO_DIR = "speech-samples"
os.makedirs(AUDIO_DIR, exist_ok=True)


# Function to send request to the external API
def send_request(base_url, **params):
    if "json" in params:
        params["json"] = json.dumps(params["json"])
    query_string = urllib.parse.urlencode(params, quote_via=urllib.parse.quote)
    full_url = f"{base_url}?{query_string}"
    print(f"Requesting URL: {full_url}")
    with urllib.request.urlopen(full_url) as response:
        response_data = response.read().decode("utf-8")
        json_data = json.loads(response_data)
        return json_data, response.status


# Route to render the map page
@app.route("/")
def map():
    return render_template("map.html")


# WebSocket route to handle continuous geolocation updates
@socketio.on("location_update")
def handle_geolocation_update(data):
    latitude = data.get("lat")
    longitude = data.get("lon")
    accuracy = data.get("acc")
    if latitude and longitude:
        print(f"Updated Location: Lat: {latitude}, Lon: {longitude}")
        # Emit an acknowledgment (optional)
        # emit("location_ack", {"message": "Location received", "latitude": latitude, "longitude": longitude, "accuracy": accuracy})
    else:
        emit("location_ack", {"error": "Invalid location data"})


# API endpoint to handle search input and return points
@app.route("/api/search", methods=["GET"])
def search():
    user_query = request.args.get("query")  # Get user input
    if not user_query:
        return jsonify({"error": "No query provided"}), 400

    base_url = "http://192.168.4.23:8010/search"  # External API
    try:
        # Call the search API
        response_data, status = send_request(
            base_url, q=user_query, format="json", limit=100
        )

        # Convert the response into Point geometries (GeoJSON FeatureCollection)
        features = []
        for result in response_data:
            if "lat" in result and "lon" in result:  # Ensure lat/lon exist
                features.append(
                    {
                        "type": "Feature",
                        "geometry": {
                            "type": "Point",
                            "coordinates": [float(result["lon"]), float(result["lat"])],
                        },
                        "properties": {
                            "name": result.get("display_name", "Unnamed Location")
                        },
                    }
                )

        return jsonify({"type": "FeatureCollection", "features": features})

    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/route", methods=["GET"])
def get_route():
    # Get the query parameters for the start and end points
    lat_start = float(request.args.get("lat_start"))
    lon_start = float(request.args.get("lon_start"))
    lat_end = float(request.args.get("lat_end"))
    lon_end = float(request.args.get("lon_end"))
    heading = float(request.args.get("heading"))
    heading_tolerance = float(request.args.get("heading_tolerance"))

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
                    "top_speed": 140,
                }
            },
            "exclude_polygons": [],
            "locations": [
                {
                    "lon": lon_start,
                    "lat": lat_start,
                    "type": "break",
                    "heading": heading,
                    "heading_tolerance": heading_tolerance,
                },
                {"lon": lon_end, "lat": lat_end, "type": "break"},
            ],
            "directions_options": {"units": "miles"},
            "id": "valhalla_directions",
        }
    }

    resp, status = send_request(base_url, **params)
    print(json.dumps(resp, indent=4))

    resp["trip"]["shape"] = polyline.decode(
        resp["trip"]["legs"][-1]["shape"], geojson=True
    )
    resp["trip"]["shape"] = [[y / 10 for y in x] for x in resp["trip"]["shape"]]
    del resp["trip"]["legs"][-1]["shape"]

    # resp['decoded_shape'] = polyline.decode(resp['trip']['legs'][-1]['shape'])

    # Check if the request was successful
    if status == 200:
        return jsonify(resp)
    else:
        return jsonify({"error": "Failed to get route"}), status_code


# Serve the audio directory so that files can be accessed via a URL
@app.route("/audio/<filename>")
def serve_audio(filename):
    return send_from_directory(AUDIO_DIR, filename, mimetype="audio/wav")


@app.route("/api/audiogen", methods=["POST"])
def generate_audio():
    data = request.json
    if "texts" not in data or not isinstance(data["texts"], list):
        return jsonify({"error": "Invalid input. Provide a 'texts' array."}), 400

    texts = data["texts"]
    json_inputs = []
    audio_urls = []

    total_words = 0

    for text in texts:
        task_id = abs(hash(text))

        filename = f"{task_id}.wav"
        filepath = os.path.join(AUDIO_DIR, filename)

        # If file already exists, no need to regenerate
        if os.path.exists(filepath):
            audio_urls.append(f"/audio/{filename}")
            continue

        # Create JSON input for piper
        json_inputs.append(f'{{"text": "{text}", "output_file": "{filepath}"}}')
        audio_urls.append(f"/audio/{filename}")
        total_words += len(text.split(' '))

    if not json_inputs:
        # All files already exist, return their URLs
        return jsonify({"audio_urls": audio_urls}), 200

    # printing the total words in all of the input
    print(f'Generating {total_words} total words of audio...')

    try:
        # Concatenate all JSON inputs and pass them to piper
        json_input_str = "\n".join(json_inputs)
        command = f"echo '{json_input_str}' | piper/install/piper --model speech-models/en_US-amy-low.onnx --json-input"
        os.system(command)

        return jsonify({"audio_urls": audio_urls}), 200

    except Exception as e:
        print(f"Error during audio generation: {e}")
        return jsonify({"error": str(e)}), 500


if __name__ == "__main__":
    context = ("cert/server.crt", "cert/server.key")  # certificate and key files
    socketio.run(app, host="0.0.0.0", debug=True, ssl_context=context)
