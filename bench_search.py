from urllib import request, parse
import time
import urllib
import json

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

data = dict(
    q='2301 kenmore ave',
    lat=52.38,
    lon=-80,
    limit=5,
)

t1 = time.time()
resp = send_request('http://192.168.4.23:2322/api', **data)
# print(json.dumps(resp, indent=4))
print(time.time()-t1)


# Query parameters passed as kwargs
params = {"q": data['q'], "format": "json", "limit": data['limit']}

t1 = time.time()
resp = send_request('http://192.168.4.23:8010/search', **params)
# print(json.dumps(resp, indent=4))
print(time.time()-t1)
