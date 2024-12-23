import urllib.parse
import urllib.request
import json
import polyline


def send_request(base_url: str, **params) -> dict:
    """
    Sends a request to the given base URL with query parameters using kwargs.

    Args:
        base_url (str): The base URL of the request.
        **params: Arbitrary keyword arguments representing query parameters.

    Returns:
        dict: Parsed JSON response.
    """
    # Encode the query parameters

    if "json" in params:
        params["json"] = json.dumps(params["json"])

    query_string = urllib.parse.urlencode(params, quote_via=urllib.parse.quote)

    # Build the full URL
    full_url = f"{base_url}?{query_string}"
    print(f"Requesting URL: {full_url}")

    # Send the request and get the response
    with urllib.request.urlopen(full_url) as response:
        # Read and decode the response
        response_data = response.read().decode("utf-8")

        # Parse JSON
        json_data = json.loads(response_data)
        return json_data


if __name__ == "__main__":
    # Base URL without query parameters
    base_url = "http://192.168.4.23:8010/search"

    # Query parameters passed as kwargs
    params = {"q": "871 shawnee ave", "format": "json", "limit": 100}

    # Send request and get JSON response

    # Print the JSON response
    print(json.dumps(send_request(base_url, **params), indent=4))

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
                {"lon": -87.65579223632814, "lat": 41.789744876718984, "type": "break"},
                {"lon": -87.67776489257814, "lat": 41.64110468287587, "type": "break"},
            ],
            "directions_options": {"units": "kilometers"},
            "id": "valhalla_directions",
        }
    }

    resp = send_request(base_url, **params)
    print(json.dumps(resp, indent=4))

    decoded_shape = polyline.decode(resp["trip"]["legs"][-1]["shape"], geojson=True)
    decoded_shape = [[y / 10 for y in x] for x in decoded_shape]

    # Print decoded points
    for point in decoded_shape:
        print(f"Lat: {point[0]}, Lon: {point[1]}")
